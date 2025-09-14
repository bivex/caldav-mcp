import { WebDAVClient } from "webdav"
import { z } from "zod"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

export function registerDeleteEvent(client: WebDAVClient, server: McpServer) {
  server.tool(
    "delete-event",
    "Delete a calendar event by its unique identifier (UID). Permanently removes the event from the specified calendar on the CalDAV server.",
    { 
      uid: z.string().describe("Unique identifier of the event to delete (obtained from list-events)"), 
      calendarUrl: z.string().describe("URL of the calendar containing the event (use list-calendars to get available URLs)") 
    },
    async ({ uid, calendarUrl }) => {
      try {
        const filename = `${uid}.ics`
        const filePath = calendarUrl.endsWith("/") ? `${calendarUrl}${filename}` : `${calendarUrl}/${filename}`
        
        await client.deleteFile(filePath)
        
        return {
          content: [{ type: "text", text: "Event deleted successfully" }],
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error deleting event: ${error}` }],
        }
      }
    },
  )
}
