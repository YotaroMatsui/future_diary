import { afterEach, describe, expect, test } from "bun:test";
import { fetchGoogleCalendarScheduleLines, GoogleCalendarError } from "./googleCalendar";

describe("googleCalendar schedule fetch", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("fetches events from hidden calendars too", async () => {
    let calendarListShowHidden: string | null = null;

    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);

      if (url.startsWith("https://www.googleapis.com/calendar/v3/users/me/calendarList")) {
        calendarListShowHidden = new URL(url).searchParams.get("showHidden");
        return new Response(
          JSON.stringify({
            items: [
              { id: "primary", selected: true, hidden: false },
              { id: "team.hidden@example.com", selected: false, hidden: true },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/primary/events")) {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/team.hidden%40example.com/events")) {
        const authHeader = init?.headers ? new Headers(init.headers as HeadersInit).get("authorization") : null;
        if (authHeader !== "Bearer test-access-token") {
          return new Response("unauthorized", { status: 401 });
        }

        return new Response(
          JSON.stringify({
            items: [
              {
                summary: "深夜作業",
                start: { dateTime: "2026-03-09T00:30:00+09:00" },
                end: { dateTime: "2026-03-09T01:00:00+09:00" },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response("unexpected", { status: 404 });
    };

    const lines = await fetchGoogleCalendarScheduleLines({
      accessToken: "test-access-token",
      date: "2026-03-09",
      timezone: "Asia/Tokyo",
    });

    expect(calendarListShowHidden).toBe("true");
    expect(lines).toContain("00:30-01:00 深夜作業");
  });

  test("throws GOOGLE_CALENDAR_API_DISABLED when Google project calendar api is disabled", async () => {
    globalThis.fetch = async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://www.googleapis.com/calendar/v3/users/me/calendarList")) {
        return new Response(
          JSON.stringify({
            error: {
              code: 403,
              message: "Google Calendar API has not been used in project 848080562572 before or it is disabled.",
              errors: [{ reason: "accessNotConfigured" }],
              status: "PERMISSION_DENIED",
              details: [
                {
                  reason: "SERVICE_DISABLED",
                  metadata: {
                    service: "calendar-json.googleapis.com",
                  },
                },
              ],
            },
          }),
          { status: 403, headers: { "content-type": "application/json" } },
        );
      }

      if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/primary/events")) {
        return new Response(
          JSON.stringify({
            error: {
              code: 403,
              message: "Google Calendar API has not been used in project 848080562572 before or it is disabled.",
              errors: [{ reason: "accessNotConfigured" }],
              status: "PERMISSION_DENIED",
              details: [
                {
                  reason: "SERVICE_DISABLED",
                  metadata: {
                    service: "calendar-json.googleapis.com",
                  },
                },
              ],
            },
          }),
          { status: 403, headers: { "content-type": "application/json" } },
        );
      }

      return new Response("unexpected", { status: 404 });
    };

    try {
      await fetchGoogleCalendarScheduleLines({
        accessToken: "test-access-token",
        date: "2026-03-09",
        timezone: "Asia/Tokyo",
      });
      throw new Error("Expected fetchGoogleCalendarScheduleLines to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(GoogleCalendarError);
      expect((error as GoogleCalendarError).type).toBe("GOOGLE_CALENDAR_API_DISABLED");
    }
  });
});
