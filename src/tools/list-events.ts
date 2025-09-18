import { WebDAVClient } from "webdav"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import axios from "axios"

const dateString = z.string().refine((val) => !isNaN(Date.parse(val)), {
  message: "Invalid date string",
})

function formatCalDAVDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z"
}

function parseCalDAVDate(dateStr: string): Date {
  // Handle different CalDAV date formats
  if (dateStr.includes('T')) {
    // YYYYMMDDTHHMMSSZ format
    const year = parseInt(dateStr.substring(0, 4))
    const month = parseInt(dateStr.substring(4, 6)) - 1
    const day = parseInt(dateStr.substring(6, 8))
    const hour = parseInt(dateStr.substring(9, 11))
    const minute = parseInt(dateStr.substring(11, 13))
    const second = parseInt(dateStr.substring(13, 15))
    return new Date(year, month, day, hour, minute, second)
  } else {
    // YYYYMMDD format (all-day events)
    const year = parseInt(dateStr.substring(0, 4))
    const month = parseInt(dateStr.substring(4, 6)) - 1
    const day = parseInt(dateStr.substring(6, 8))
    return new Date(year, month, day)
  }
}

async function getAllDirectoryContents(client: any, path: string): Promise<any[]> {
  const allItems: any[] = []
  
  try {
    const contents = await client.getDirectoryContents(path) as any[]
    
    for (const item of contents) {
      allItems.push(item)
      
      if (item.type === "directory" && !item.filename.includes('..')) {
        try {
          const subContents = await getAllDirectoryContents(client, item.filename)
          allItems.push(...subContents)
        } catch (error) {
          console.error(`[DEBUG] Error accessing subdirectory ${item.filename}: ${error}`)
        }
      }
    }
  } catch (error) {
    console.error(`[DEBUG] Error accessing directory ${path}: ${error}`)
  }
  
  return allItems
}

function parseICSContent(icsContent: string): any[] {
  const events = []
  const lines = icsContent.split('\n')
  let currentEvent: any = null
  let inEvent = false
  
  for (const line of lines) {
    const trimmed = line.trim()
    
    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true
      currentEvent = {}
    } else if (trimmed === 'END:VEVENT') {
      if (currentEvent && currentEvent.summary) {
        events.push(currentEvent)
      }
      inEvent = false
      currentEvent = null
    } else if (inEvent && currentEvent) {
      if (trimmed.startsWith('SUMMARY:')) {
        currentEvent.summary = trimmed.substring(8)
      } else if (trimmed.startsWith('DTSTART:') || trimmed.startsWith('DTSTART;')) {
        const dateValue = trimmed.split(':')[1]
        currentEvent.start = dateValue
        currentEvent.startDate = parseCalDAVDate(dateValue)
      } else if (trimmed.startsWith('DTEND:') || trimmed.startsWith('DTEND;')) {
        const dateValue = trimmed.split(':')[1]
        currentEvent.end = dateValue
        currentEvent.endDate = parseCalDAVDate(dateValue)
      } else if (trimmed.startsWith('UID:')) {
        currentEvent.uid = trimmed.substring(4)
      } else if (trimmed.startsWith('DESCRIPTION:')) {
        currentEvent.description = trimmed.substring(12)
      } else if (trimmed.startsWith('LOCATION:')) {
        currentEvent.location = trimmed.substring(9)
      }
    }
  }
  
  return events
}

async function performCalDAVReport(baseUrl: string, username: string, password: string, calendarPath: string, startDate: string, endDate: string): Promise<any[]> {
  const startFormatted = formatCalDAVDate(new Date(startDate))
  const endFormatted = formatCalDAVDate(new Date(endDate))
  
  const reportBody = `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag />
    <C:calendar-data />
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${startFormatted}" end="${endFormatted}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`

  try {
    console.error(`[DEBUG] Performing CalDAV REPORT on: ${baseUrl}${calendarPath}`)
    console.error(`[DEBUG] Date range: ${startFormatted} to ${endFormatted}`)
    
    const DigestFetch = (await import('digest-fetch')).default
    const digestClient = new DigestFetch(username, password)
    
    const response = await digestClient.fetch(`${baseUrl}${calendarPath}`, {
      method: 'REPORT',
      body: reportBody,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '1'
      }
    })
    
    const responseText = await response.text()
    console.error(`[DEBUG] REPORT response status: ${response.status}`)
    console.error(`[DEBUG] REPORT response data preview:`, responseText.substring(0, 500) + "...")
    
    // Parse XML response to extract calendar data
    const events = []
    const calendarDataMatches = responseText.match(/<C:calendar-data[^>]*>([\s\S]*?)<\/C:calendar-data>/gi)
    
    if (calendarDataMatches) {
      console.error(`[DEBUG] Found ${calendarDataMatches.length} calendar-data entries`)
      
      for (const match of calendarDataMatches) {
        const icsContent = match.replace(/<\/?C:calendar-data[^>]*>/gi, '').trim()
        if (icsContent) {
          const parsedEvents = parseICSContent(icsContent)
          events.push(...parsedEvents)
        }
      }
    }
    
    return events
  } catch (error) {
    console.error(`[DEBUG] CalDAV REPORT failed: ${error}`)
    return []
  }
}

function normalizeDateRange(start: string, end: string): { start: string, end: string } {
  // Handle incomplete end dates (e.g., "2025" -> "2025-12-31T23:59:59Z")
  let normalizedEnd = end
  if (end && end.length === 4 && /^\d{4}$/.test(end)) {
    normalizedEnd = `${end}-12-31T23:59:59Z`
  } else if (end && end.length === 7 && /^\d{4}-\d{2}$/.test(end)) {
    // Handle YYYY-MM format
    const lastDay = new Date(parseInt(end.substring(0, 4)), parseInt(end.substring(5, 7)), 0).getDate()
    normalizedEnd = `${end}-${lastDay.toString().padStart(2, '0')}T23:59:59Z`
  } else if (end && end.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
    // Handle YYYY-MM-DD format
    normalizedEnd = `${end}T23:59:59Z`
  }
  
  // Handle incomplete start dates
  let normalizedStart = start
  if (start && start.length === 4 && /^\d{4}$/.test(start)) {
    normalizedStart = `${start}-01-01T00:00:00Z`
  } else if (start && start.length === 7 && /^\d{4}-\d{2}$/.test(start)) {
    normalizedStart = `${start}-01T00:00:00Z`
  } else if (start && start.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(start)) {
    normalizedStart = `${start}T00:00:00Z`
  }
  
  return { start: normalizedStart, end: normalizedEnd }
}

export function registerListEvents(client: WebDAVClient, server: McpServer) {
  server.tool(
    "list-events",
    "List all calendar events within a specified date range. Uses CalDAV REPORT method for efficient querying and supports both single and recurring events. Returns event details including summary, start/end times, and descriptions.",
    { 
      start: dateString.describe("Start date for the event search range (ISO 8601 format, e.g., '2025-09-10T00:00:00Z')"), 
      end: dateString.describe("End date for the event search range (ISO 8601 format, e.g., '2025-09-10T23:59:59Z')"), 
      calendarUrl: z.string().describe("URL of the calendar to search (use list-calendars to get available URLs)") 
    },
    async ({ calendarUrl, start, end }) => {
      try {
        // Normalize date ranges to handle incomplete dates
        const { start: normalizedStart, end: normalizedEnd } = normalizeDateRange(start, end)
        
        console.error(`[DEBUG] Listing events in: ${calendarUrl}`)
        console.error(`[DEBUG] Original date range: ${start} to ${end}`)
        console.error(`[DEBUG] Normalized date range: ${normalizedStart} to ${normalizedEnd}`)
        
        let allEvents = []
        
        // Approach 1: Try CalDAV REPORT method (proper CalDAV way)
        try {
          const baseUrl = process.env.CALDAV_BASE_URL || ""
          const username = process.env.CALDAV_USERNAME || ""
          const password = process.env.CALDAV_PASSWORD || ""
          
          console.error(`[DEBUG] Trying CalDAV REPORT method...`)
          const caldavEvents = await performCalDAVReport(baseUrl, username, password, calendarUrl, normalizedStart, normalizedEnd)
          
          if (caldavEvents.length > 0) {
            console.error(`[DEBUG] CalDAV REPORT found ${caldavEvents.length} events`)
            allEvents.push(...caldavEvents)
          }
        } catch (reportError) {
          console.error(`[DEBUG] CalDAV REPORT approach failed: ${reportError}`)
        }
        
        // Approach 2: Try WebDAV directory listing (fallback)
        if (allEvents.length === 0) {
          console.error(`[DEBUG] Trying WebDAV directory approach...`)
          
          try {
            const contents = await client.getDirectoryContents(calendarUrl) as any[]
            console.error(`[DEBUG] Found ${contents.length} items in calendar directory`)
            console.error(`[DEBUG] Directory contents:`, contents.map((item: any) => ({ name: item.filename, type: item.type })))
            
            const icsFiles = contents.filter((item: any) => 
              item.type === "file" && item.filename.endsWith('.ics')
            )
            
            console.error(`[DEBUG] Found ${icsFiles.length} .ics files:`, icsFiles.map((f: any) => f.filename))
            
            for (const file of icsFiles) {
              try {
                // Используем полный путь из file.filename
                const filePath = file.filename
                console.error(`[DEBUG] Trying to read: ${filePath}`)
                
                const icsContent = await client.getFileContents(filePath, { format: "text" }) as string
                console.error(`[DEBUG] File content preview:`, icsContent.substring(0, 200) + "...")
                
                const events = parseICSContent(icsContent)
                console.error(`[DEBUG] Parsed ${events.length} events from ${file.filename}`)
                
                // Filter events by date range (check for overlap, not strict containment)
                const filteredEvents = events.filter(event => {
                  if (!event.startDate || !event.endDate) return false
                  
                  const startDate = new Date(normalizedStart)
                  const endDate = new Date(normalizedEnd)
                  
                  console.error(`[DEBUG] Event ${event.summary}: ${event.startDate} - ${event.endDate}`)
                  console.error(`[DEBUG] Range: ${startDate} - ${endDate}`)
                  
                  // Check if event overlaps with the date range
                  // Event overlaps if: event.start < range.end AND event.end > range.start
                  const eventOverlaps = event.startDate < endDate && event.endDate > startDate
                  
                  console.error(`[DEBUG] Event overlaps: ${eventOverlaps}`)
                  return eventOverlaps
                })
                
                console.error(`[DEBUG] Filtered to ${filteredEvents.length} events in date range`)
                allEvents.push(...filteredEvents)
              } catch (fileError) {
                console.error(`[DEBUG] Error reading file ${file.filename}: ${fileError}`)
              }
            }
          } catch (dirError) {
            console.error(`[DEBUG] Error reading directory: ${dirError}`)
          }
        }
        
        // Approach 3: Try recursive directory search for .ics files
        if (allEvents.length === 0) {
          console.error(`[DEBUG] Trying recursive directory search...`)
          
          try {
            // Try to find .ics files in subdirectories
            const allContents = await getAllDirectoryContents(client, calendarUrl)
            console.error(`[DEBUG] Recursive search found ${allContents.length} total items`)
            
            const allIcsFiles = allContents.filter((item: any) => 
              item.type === "file" && item.filename.endsWith('.ics')
            )
            
            console.error(`[DEBUG] Found ${allIcsFiles.length} .ics files recursively:`, allIcsFiles.map((f: any) => f.filename))
            
            for (const file of allIcsFiles) {
              try {
                const filePath = file.filename
                console.error(`[DEBUG] Reading recursive file: ${filePath}`)
                
                const content = await client.getFileContents(filePath, { format: "text" }) as string
                console.error(`[DEBUG] File content preview:`, content.substring(0, 200) + "...")
                
                const events = parseICSContent(content)
                console.error(`[DEBUG] Parsed ${events.length} events from ${file.filename}`)
                
                // Filter by date range (check for overlap, not strict containment)
                const filteredEvents = events.filter(event => {
                  if (!event.startDate || !event.endDate) return false
                  
                  const startDate = new Date(normalizedStart)
                  const endDate = new Date(normalizedEnd)
                  
                  console.error(`[DEBUG] Event ${event.summary}: ${event.startDate} - ${event.endDate}`)
                  console.error(`[DEBUG] Range: ${startDate} - ${endDate}`)
                  
                  // Check if event overlaps with the date range
                  // Event overlaps if: event.start < range.end AND event.end > range.start
                  const eventOverlaps = event.startDate < endDate && event.endDate > startDate
                  
                  console.error(`[DEBUG] Event overlaps: ${eventOverlaps}`)
                  return eventOverlaps
                })
                
                console.error(`[DEBUG] Filtered to ${filteredEvents.length} events in date range`)
                allEvents.push(...filteredEvents)
              } catch (error) {
                console.error(`[DEBUG] Error reading recursive file ${file.filename}: ${error}`)
              }
            }
          } catch (error) {
            console.error(`[DEBUG] Error in recursive search: ${error}`)
          }
        }
        
      const data = allEvents.map((e) => ({
          summary: e.summary || "No title",
        start: e.start,
        end: e.end,
          uid: e.uid,
          description: e.description || "",
          location: e.location || ""
        }))
        
        console.error(`[DEBUG] Returning ${data.length} events total`)
        
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        }
      } catch (error) {
        console.error(`[DEBUG] Error in list-events: ${error}`)
      return {
          content: [{ type: "text", text: `Error listing events: ${error}` }],
        }
      }
    },
  )
}
