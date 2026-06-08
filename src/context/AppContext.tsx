import { createContext, useContext } from "react";

export type PageId =
  | "home" | "padtype" | "bizsignup" | "signup" | "addpad"
  | "photointro" | "photo" | "availability" | "payment" | "account"
  | "find" | "spot" | "booking" | "confirm" | "driversignup" | "driveraccount"
  | "paddashboard" | "listerbookings" | "bookings" | "admin" | "savedspots" | "customerservice"
  | "listingsuccess";

export interface BookingRec {
  id: number;
  uuid?: string;
  spotId: string;
  addr: string;
  city: string;
  padType: string;
  startTs: number;
  endTs: number;
  pricePerHr: number;
  hostName: string;
  hostPhone: string;
  status: "active" | "cancelled" | "pending" | "denied" | "approved";
}

export interface AppState {
  suAns: Record<number, string>;
  apAns: Record<number, string>;
  drAns: Record<number, string>;
  bizAns: Record<number, string>;
  bizPhotoCount: number;
  apNumPads: number;
  apLogoUrl: string;
  apSpotId: string;
  apLat: number;
  apLng: number;
  accountType: "renter" | "padRenter";
  hasBothAccounts: boolean;
  profilePhotoUrl: string;
  addingExtraPad: boolean;
  openAcctOnFind: boolean;
  apPhotoUrl: string;
  bookings: BookingRec[];
  adminPreview: boolean;
  adminPreviewRole: "admin" | "staff" | null;
}

export const DEFAULT_STATE: AppState = {
  suAns: {}, apAns: {}, drAns: {}, bizAns: {},
  bizPhotoCount: 0, apNumPads: 1, apLogoUrl: "", apSpotId: "", apLat: 0, apLng: 0,
  accountType: "renter", hasBothAccounts: true,
  profilePhotoUrl: "", addingExtraPad: false, openAcctOnFind: false, apPhotoUrl: "",
  bookings: [], adminPreview: false, adminPreviewRole: null,
};

export const STORAGE_KEY = "lilypad.appState.v1";
export const TRANSIENT_KEYS: (keyof AppState)[] = ["addingExtraPad", "openAcctOnFind", "adminPreview", "adminPreviewRole", "bookings"];

export function loadInitialState(): AppState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const saved = JSON.parse(raw) as Partial<AppState>;
    const merged: AppState = { ...DEFAULT_STATE, ...saved };
    for (const k of TRANSIENT_KEYS) (merged as Record<string, unknown>)[k] = (DEFAULT_STATE as Record<string, unknown>)[k];
    return merged;
  } catch {
    return DEFAULT_STATE;
  }
}

export interface AppCtx {
  goTo: (page: PageId) => void;
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
}

export const AppContext = createContext<AppCtx>({
  goTo: () => {},
  state: DEFAULT_STATE,
  setState: () => {},
});

export function useApp() { return useContext(AppContext); }
