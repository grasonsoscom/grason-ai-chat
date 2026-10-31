import { describe, expect, it } from "vitest";
import { allowedModules, canAccess, MODULES } from "@/lib/permissions";

describe("role permissions", () => {
  it("gives Admin every module regardless of the stored list", () => {
    expect(allowedModules({ name: "Admin", permissions: "" })).toEqual([...MODULES]);
  });

  it('treats "all" as every module', () => {
    expect(allowedModules({ name: "Supervisor", permissions: "all" })).toEqual([...MODULES]);
  });

  it("limits other roles to their listed modules", () => {
    const cs = { name: "Staf CS", permissions: "pesan,pelanggan,kalender" };
    expect(canAccess(cs, "pesan")).toBe(true);
    expect(canAccess(cs, "produk")).toBe(false);
    expect(canAccess(cs, "broadcast")).toBe(false);
    expect(canAccess(cs, "staff")).toBe(false);
  });

  it("ignores unknown keys and whitespace", () => {
    expect(allowedModules({ name: "X", permissions: " broadcast , hack ,audience" })).toEqual([
      "broadcast",
      "audience",
    ]);
  });

  it("denies everything for an empty list", () => {
    expect(allowedModules({ name: "Baru", permissions: "" })).toEqual([]);
  });
});
