// src/api/okxClient.ts
import { getApiBase } from "./baseUrl";

export type OkxFundOverviewResponse = {
  totalEquity: number;
  balance: number;
  raw: any;
};

const API_BASE = getApiBase();

export async function fetchOkxFundOverview(): Promise<OkxFundOverviewResponse> {
  const res = await fetch(`${API_BASE}/api/fund-overview`);

  if (!res.ok) {
    throw new Error(`Failed to fetch fund overview: ${res.status}`);
  }

  return res.json();
}
