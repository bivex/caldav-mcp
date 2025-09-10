import { WebDAVClient } from "webdav"
import { z } from "zod"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

const recurrenceRuleSchema = z.object({
  freq: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]).optional(),
  interval: z.number().optional(),
  count: z.number().optional(),
  until: z.string().datetime().optional(), // ISO 8601 string
  byday: z.array(z.string()).optional(), // e.g. ["MO", "TU"]
  bymonthday: z.array(z.number()).optional(),
  bymonth: z.array(z.number()).optional(),
})

function formatDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z"
}

function buildRRULE(recurrenceRule: any): string {
  if (!recurrenceRule) return ""
  
  const parts = []
  if (recurrenceRule.freq) parts.push(`FREQ=${recurrenceRule.freq}`)
  if (recurrenceRule.interval) parts.push(`INTERVAL=${recurrenceRule.interval}`)
  if (recurrenceRule.count) parts.push(`COUNT=${recurrenceRule.count}`)
  if (recurrenceRule.until) parts.push(`UNTIL=${formatDate(new Date(recurrenceRule.until))}`)
  if (recurrenceRule.byday) parts.push(`BYDAY=${recurrenceRule.byday.join(",")}`)
  if (recurrenceRule.bymonthday) parts.push(`BYMONTHDAY=${recurrenceRule.bymonthday.join(",")}`)
  if (recurrenceRule.bymonth) parts.push(`BYMONTH=${recurrenceRule.bymonth.join(",")}`)
  
  return parts.length > 0 ? `RRULE:${parts.join(";")}` : ""
}

function generateUID(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}@caldav-mcp`
}

function buildICSContent(summary: string, start: string, end: string, recurrenceRule: any): string {
  const uid = generateUID()
  const startDate = new Date(start)
  const endDate = new Date(end)
  const now = new Date()
  
  const rrule = buildRRULE(recurrenceRule)
  
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//caldav-mcp//CalDAV Client//EN
BEGIN:VEVENT
UID:${uid}
DTSTAMP:${formatDate(now)}
DTSTART:${formatDate(startDate)}
DTEND:${formatDate(endDate)}
SUMMARY:${summary}
${rrule}
END:VEVENT
END:VCALENDAR`
}

export function registerCreateEvent(client: WebDAVClient, server: McpServer) {
  server.tool(
    "create-event",
    "Creates an event in the calendar specified by its URL",
    {
      summary: z.string(),
      start: z.string().datetime(),
      end: z.string().datetime(),
      calendarUrl: z.string(),
      recurrenceRule: recurrenceRuleSchema.optional(),
    },
    async ({ calendarUrl, summary, start, end, recurrenceRule }) => {
      try {
        console.error(`[DEBUG] Creating event in calendar: ${calendarUrl}`)
        console.error(`[DEBUG] Event details: ${summary} from ${start} to ${end}`)
        
        const uid = generateUID()
        const icsContent = buildICSContent(summary, start, end, recurrenceRule)
        const filename = `${uid}.ics`
        const filePath = calendarUrl.endsWith("/") ? `${calendarUrl}${filename}` : `${calendarUrl}/${filename}`
        
        console.error(`[DEBUG] File path: ${filePath}`)
        console.error(`[DEBUG] ICS content preview:`, icsContent.substring(0, 200) + "...")
        
        // Try different approaches for creating events
        try {
          // First try: Standard PUT with CalDAV headers
          await client.putFileContents(filePath, icsContent, {
            overwrite: true,
            headers: {
              "Content-Type": "text/calendar; charset=utf-8",
              "If-None-Match": "*"  // CalDAV specific header
            }
          })
        } catch (putError) {
          console.error(`[DEBUG] PUT failed, trying alternative method: ${putError}`)
          
          // Second try: Use MKCALENDAR method if directory doesn't exist
          try {
            // Check if calendar directory exists and is writable
            const calendarExists = await client.exists(calendarUrl)
            if (!calendarExists) {
              console.error(`[DEBUG] Calendar directory doesn't exist, creating it`)
              await client.createDirectory(calendarUrl, { recursive: true })
            }
            
            // Try PUT again after ensuring directory exists
            await client.putFileContents(filePath, icsContent, {
              overwrite: true,
              headers: {
                "Content-Type": "text/calendar; charset=utf-8"
              }
            })
          } catch (altError) {
            console.error(`[DEBUG] Alternative method also failed: ${altError}`)
            throw altError
          }
        }
        
        console.error(`[DEBUG] Event created successfully: ${uid}`)
        return {
          content: [{ type: "text", text: uid }],
        }
      } catch (error) {
        console.error(`[DEBUG] Error creating event: ${error}`)
        return {
          content: [{ type: "text", text: `Error creating event: ${error}` }],
        }
      }
    },
  )
}
