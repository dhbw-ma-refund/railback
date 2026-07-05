import { makeBadDb } from "./helpers.js";

const bad = makeBadDb();
const E = "conn_err_ts@it.de";

describe("connection errors", () => {
  test("get returns Err", async () => {
    expect((await bad.user.get(E)).isErr()).toBe(true);
  });

  test("put returns Err", async () => {
    expect((await bad.user.put({ pk: `USER#${E}`, sk: "PROFILE" })).isErr()).toBe(true);
  });

  test("update returns Err", async () => {
    expect((await bad.user.update(E, { name: "X" })).isErr()).toBe(true);
  });

  test("query returns Err", async () => {
    expect((await bad.user.listAll()).isErr()).toBe(true);
  });

  test("delete returns Err", async () => {
    expect((await bad.user._delete(`USER#${E}`, "PROFILE")).isErr()).toBe(true);
  });

  test("stampPain008Built returns Err", async () => {
    expect((await bad.mandate.stampPain008Built(E, "T_CE", "B", "s3.xml", "2026-01-01T00:00:00Z")).isErr()).toBe(true);
  });
});
