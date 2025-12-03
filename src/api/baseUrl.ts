// Utility to build a safe API base URL for frontend fetches.
// - Prefer VITE_API_BASE
// - Fallback to window.origin (when available)
// - Finally use http://localhost:4000 for local dev

const defaultApiBase = "http://localhost:4000";

export function sanitizeBaseUrl(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // If scheme is missing, assume http
  const withScheme =
    trimmed.includes("://") || trimmed.startsWith("//")
      ? trimmed
      : `http://${trimmed}`;

  try {
    new URL(withScheme); // validate
    return trimmed.replace(/\/$/, "");
  } catch {
    console.warn("⚠️ Invalid API base URL, fallback will be used:", raw);
    return null;
  }
}

export function getApiBase(): string {
  const winOrigin =
    typeof window !== "undefined" ? window.location.origin : null;

  // In dev, prefer explicit VITE_API_BASE then localhost:4000.
  if (import.meta.env?.DEV) {
    return (
      sanitizeBaseUrl(import.meta.env?.VITE_API_BASE) ||
      defaultApiBase
    );
  }

  // In production build, prefer VITE_API_BASE, then current origin, then localhost:4000.
  return (
    sanitizeBaseUrl(import.meta.env?.VITE_API_BASE) ||
    sanitizeBaseUrl(winOrigin) ||
    defaultApiBase
  );
}
