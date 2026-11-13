/**
 * API client module for ApexFlow Billing
 */

let onSessionExpired = null;

export function setSessionExpiredHandler(handler) {
  onSessionExpired = handler;
}

export async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401 && typeof onSessionExpired === "function") {
    onSessionExpired("Your session has expired. Please sign in again.");
  }

  if (response.status === 404 && data.error === "API endpoint not found.") {
    throw new Error(
      "The billing server API was not found. Please ensure the server is running with `npm start`."
    );
  }

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }

  return data;
}
