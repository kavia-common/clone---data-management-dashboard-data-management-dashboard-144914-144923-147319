const request = require("supertest");
const app = require("../../app");
const SessionTrackingModel = require("../../models/sessionTracking.model");

describe("Session date range filtering", () => {
  let server;
  beforeAll((done) => {
    server = app.listen(0, done);
  });
  afterAll((done) => {
    server.close(done);
  });

  it("returns only sessions in date range", async () => {
    // Clean up any existing data first
    await SessionTrackingModel.deleteMany({});
    // Insert test data
    await SessionTrackingModel.create([
      { session_start: "2024-03-01T00:00:00.000Z", foo: "bar", tenant_id: "t1" },
      { session_start: "2024-03-10T00:00:00.000Z", foo: "baz", tenant_id: "t1" },
      { session_start: "2024-03-20T00:00:00.000Z", foo: "qux", tenant_id: "t1" },
    ]);
    const res = await request(server)
      .get("/api/session-tracking")
      .query({
        tenant_id: "t1",
        startDate: "2024-03-05T00:00:00.000Z",
        endDate: "2024-03-15T23:59:59.000Z",
      });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Should contain only the middle session
    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ session_start: "2024-03-10T00:00:00.000Z" }),
      ])
    );
    // And should not contain sessions outside window
    expect(res.body).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ session_start: "2024-03-01T00:00:00.000Z" }),
      ])
    );
    expect(res.body).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ session_start: "2024-03-20T00:00:00.000Z" }),
      ])
    );
  });
});
