import { WebDAVClient } from "webdav"
import { z } from "zod"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

export function registerDeleteEvent(client: WebDAVClient, server: McpServer) {
  server.tool(
    "delete-event",
    "Deletes an event in the calendar specified by its URL",
    { uid: z.string(), calendarUrl: z.string() },
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
