import { WebDAVClient } from "webdav"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

export async function registerListCalendars(
  client: WebDAVClient,
  server: McpServer,
) {
  server.tool(
    "list-calendars",
    "List all calendars returning both name and URL",
    {},
    async () => {
      try {
        // First check root directory
        const rootContents = await client.getDirectoryContents("/") as any[]
        console.error(`[DEBUG] Root contents:`, rootContents.map((item: any) => ({ name: item.filename, type: item.type })))
        
        // Check calendars directory specifically
        let calendars: any[] = []
        try {
          const calendarsContents = await client.getDirectoryContents("/calendars") as any[]
          console.error(`[DEBUG] Calendars contents:`, calendarsContents.map((item: any) => ({ name: item.filename, type: item.type })))
          
          // Also check nested directories in /calendars/calendar
          for (const calendarDir of calendarsContents) {
            if (calendarDir.type === "directory") {
              try {
                const nestedContents = await client.getDirectoryContents(calendarDir.filename) as any[]
                console.error(`[DEBUG] ${calendarDir.filename} nested contents:`, nestedContents.map((item: any) => ({ name: item.filename, type: item.type })))
                
                // Add nested calendars (exclude inbox/outbox)
                const nestedCalendars = nestedContents
                  .filter((item: any) => {
                    const name = item.filename.split('/').pop()
                    return item.type === "directory" && 
                           !item.filename.includes('.') && 
                           name !== 'inbox' && 
                           name !== 'outbox'
                  })
                  .map((item: any) => ({ 
                    name: `📅 ${item.filename.split('/').pop()}`, 
                    url: item.filename
                  }))
                
                calendars.push(...nestedCalendars)
              } catch (nestedError) {
                console.error(`[DEBUG] Error accessing ${calendarDir.filename}: ${nestedError}`)
              }
            }
          }
          
          // Also add top-level calendar directories
          const topLevelCalendars = calendarsContents
            .filter((item: any) => item.type === "directory" && item.filename !== ".")
            .map((item: any) => ({ 
              name: `📅 ${item.filename.replace('/calendars/', '')} (Root)`, 
              url: item.filename
            }))
          
          calendars.push(...topLevelCalendars)
        } catch (calendarsError) {
          console.error(`[DEBUG] Error accessing /calendars: ${calendarsError}`)
        }
        
        // Also check principals directory for user calendars
        try {
          const principalsContents = await client.getDirectoryContents("/principals") as any[]
          console.error(`[DEBUG] Principals contents:`, principalsContents.map((item: any) => ({ name: item.filename, type: item.type })))
          
          // Check nested directories in principals for actual calendar paths
          for (const principalDir of principalsContents) {
            if (principalDir.type === "directory") {
              try {
                const userContents = await client.getDirectoryContents(principalDir.filename) as any[]
                console.error(`[DEBUG] ${principalDir.filename} contents:`, userContents.map((item: any) => ({ name: item.filename, type: item.type })))
                
                // Look for calendar-home-set or calendar directories (exclude inbox/outbox)
                const userCalendars = userContents
                  .filter((item: any) => {
                    const name = item.filename.split('/').pop()
                    return item.type === "directory" && 
                           name !== 'inbox' && 
                           name !== 'outbox'
                  })
                  .map((item: any) => ({ 
                    name: `👤 ${item.filename.split('/').pop()} (in ${principalDir.filename})`, 
                    url: item.filename
                  }))
                
                calendars.push(...userCalendars)
              } catch (userError) {
                console.error(`[DEBUG] Error accessing ${principalDir.filename}: ${userError}`)
              }
            }
          }
          
          // Also add top-level principal directories as potential calendars
          const topLevelPrincipals = principalsContents
            .filter((item: any) => item.type === "directory" && item.filename !== ".")
            .map((item: any) => ({ 
              name: `👤 ${item.filename.replace('/principals/', '')} (Principal)`, 
              url: item.filename
            }))
          
          calendars.push(...topLevelPrincipals)
        } catch (principalsError) {
          console.error(`[DEBUG] Error accessing /principals: ${principalsError}`)
        }
        
        // Remove duplicates based on URL
        const uniqueCalendars = calendars.filter((calendar, index, self) => 
          index === self.findIndex(c => c.url === calendar.url)
        )
        
        return { content: [{ type: "text", text: JSON.stringify(uniqueCalendars) }] }
      } catch (error) {
        return { 
          content: [{ 
            type: "text", 
            text: `Error listing calendars: ${error}` 
          }] 
        }
      }
    },
  )
}
