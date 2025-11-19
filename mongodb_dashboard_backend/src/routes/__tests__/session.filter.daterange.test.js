import request from "supertest";
import app from "../../app";
import SessionTrackingModel from "../../models/sessionTracking.model";

describe("Session date range filtering", () => {
  let server;
  beforeAll((done) => {
    server = app.listen(0, done);
  });
  afterAll((done) => {
    server.close(done);
  });

  it("returns only sessions in date range", async () => {
    // Insert test data
    await SessionTrackingModel.create([
      { session_start: "2024-03-01T00:00:00.000Z", foo: "bar" },
      { session_start: "2024-03-10T00:00:00.000Z", foo: "baz" },
      { session_start: "2024-03-20T00:00:00.000Z", foo: "qux" },
    ]);
    const res = await request(server).get("/api/sessions").query({
      filter: JSON.stringify({
        session_start: "2024-03-05T00:00:00.000Z",
        session_end: "2024-03-15T23:59:59.000Z",
      }),
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Should contain only middle session
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
