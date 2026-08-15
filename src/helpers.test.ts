import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { getVerificationRegistry } from "./helpers.js";

describe("getVerificationRegistry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads verified-versions.json from the current working directory when present", () => {
    const registry = getVerificationRegistry();
    expect(registry.length).toBeGreaterThan(0);
    expect(registry[0]).toHaveProperty("fvtt");
    expect(registry[0]).toHaveProperty("system");
  });

  it("falls back to the package-relative registry when cwd has no verified-versions.json", () => {
    // Simulates running as an installed dependency, where cwd is the
    // *consumer's* project rather than this package's own repo root.
    // (process.chdir isn't usable under Playwright's test worker, so
    // this stubs process.cwd() instead of actually changing directory.)
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-registry-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    try {
      const registry = getVerificationRegistry();
      expect(registry.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("falls back to the package-relative registry when cwd's verified-versions.json is malformed", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-registry-test-"));
    fs.writeFileSync(path.join(tmpDir, "verified-versions.json"), "{ not valid json");
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    try {
      const registry = getVerificationRegistry();
      expect(registry.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("falls back to the package-relative registry when cwd's verified-versions.json is valid JSON with the wrong shape", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-registry-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "verified-versions.json"),
      JSON.stringify({ not: "an array" }),
    );
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    try {
      const registry = getVerificationRegistry();
      expect(registry.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("falls back to the package-relative registry when cwd's verified-versions.json is an array with invalid entries", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-registry-test-"));
    fs.writeFileSync(path.join(tmpDir, "verified-versions.json"), JSON.stringify([{ fvtt: "13" }]));
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    try {
      const registry = getVerificationRegistry();
      expect(registry.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
