import { describe, expect, it } from "vitest";

import { parseCspReports } from "@/lib/security/csp-report";

describe("parseCspReports", () => {
  it("normalizes the legacy report-uri shape", () => {
    const reports = parseCspReports({
      "csp-report": {
        "document-uri": "https://app.example.com/mail",
        "blocked-uri": "https://evil.example.com/x.js",
        "violated-directive": "script-src-elem",
        "effective-directive": "script-src",
        disposition: "report",
      },
    });

    expect(reports).toEqual([
      {
        document_path: "/mail",
        blocked_origin: "https://evil.example.com",
        violated_directive: "script-src-elem",
        effective_directive: "script-src",
        disposition: "report",
      },
    ]);
  });

  it("accepts the Reporting API array shape", () => {
    const reports = parseCspReports([
      { type: "csp-violation", body: { "blocked-uri": "https://cdn.example.com" } },
      {
        type: "csp-violation",
        body: {
          "document-uri": "https://app.example.com/inbox",
          "violated-directive": "connect-src",
        },
      },
    ]);

    expect(reports).toHaveLength(2);
    expect(reports[0].blocked_origin).toBe("https://cdn.example.com");
    expect(reports[1].document_path).toBe("/inbox");
  });

  it("drops the query string so a report cannot leak a token", () => {
    const [report] = parseCspReports({
      "csp-report": {
        "document-uri": "https://app.example.com/mail?token=super-secret",
        "violated-directive": "script-src",
      },
    });
    expect(report.document_path).toBe("/mail");
    expect(JSON.stringify(report)).not.toContain("super-secret");
  });

  it("classifies opaque and relative blocked URIs", () => {
    expect(blockedOriginOf("data:text/html,<script>")).toBe("data:");
    expect(blockedOriginOf("blob:https://app.example.com/abc")).toBe("blob:");
    expect(blockedOriginOf("self")).toBe("self");
    expect(blockedOriginOf("/api/something")).toBe("self");

    function blockedOriginOf(uri: string): string | undefined {
      return parseCspReports({
        "csp-report": { "blocked-uri": uri, "violated-directive": "script-src" },
      })[0]?.blocked_origin;
    }
  });

  it("ignores payloads with no actionable violation", () => {
    expect(parseCspReports(null)).toEqual([]);
    expect(parseCspReports("nope")).toEqual([]);
    expect(parseCspReports({})).toEqual([]);
    expect(parseCspReports([42, "x", null])).toEqual([]);
    // Neither a directive nor a blocked origin → dropped.
    expect(parseCspReports({ "csp-report": { disposition: "report" } })).toEqual([]);
  });
});
