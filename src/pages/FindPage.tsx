import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import {
  loadTickets, mutateTickets, subscribeTickets,
  getOrCreateUserId, makeId, formatSupportTime, ticketLastPreview,
  type SupportTicket,
} from "@/lib/support";
import { supabase } from "@/lib/supabase";
import { MapContainer, TileLayer, Marker, Pane, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

// Patch Leaflet's default icon URLs so they resolve correctly through Vite's bundler.
// Leaflet stores a private _getIconUrl method that bypasses mergeOptions; removing it
// forces the class to use the bundled asset URLs from the imports above.
interface IconDefaultWithPrivate {
  _getIconUrl?: () => string;
}
delete (L.Icon.Default.prototype as IconDefaultWithPrivate)._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow });

const CITY_CENTER: [number, number] = [29.7604, -95.3698];
const CITY_ZOOM = 11;
const NEIGHBORHOOD_ZOOM = 14;
const GLOBE_CENTER: [number, number] = [20, 0];
const GLOBE_ZOOM = 2;

type SpotRecord = { id: string; price: string; addr: string; meta: string; lat: number; lng: number; featured: boolean; host_name?: string; photo_url?: string; photo_urls?: string[]; services?: string[] };

const SPOTS: SpotRecord[] = [];

const FILTERS = ["All", "Driveway", "Garage", "Covered", "EV"];
// CartoDB Voyager (light) — kept for reference but not currently used
const VOYAGER_TILE = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
// CartoDB Dark Matter with labels — shows all neighbourhood/suburb names in white text
const DARK_TILE   = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDist(km: number): string {
  const ft = km * 3280.84;
  if (ft < 1000) return `${Math.round(ft / 50) * 50} ft`;
  const mi = km * 0.621371;
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}

// ── Area / neighbourhood text labels ─────────────────────────────────────────
interface AreaLabel { name: string; lat: number; lng: number; minZoom: number; size: "md" | "sm"; }

const AREA_LABELS: AreaLabel[] = [
  // Major city areas — appear at zoom 11
  { name: "MIDTOWN",           lat: 29.7418, lng: -95.3762, minZoom: 11, size: "md" },
  { name: "MONTROSE",          lat: 29.7452, lng: -95.3920, minZoom: 11, size: "md" },
  { name: "THE HEIGHTS",       lat: 29.7900, lng: -95.3960, minZoom: 11, size: "md" },
  { name: "RIVER OAKS",        lat: 29.7508, lng: -95.4257, minZoom: 11, size: "md" },
  { name: "GALLERIA",          lat: 29.7395, lng: -95.4620, minZoom: 11, size: "md" },
  { name: "MEDICAL CENTER",    lat: 29.7085, lng: -95.3972, minZoom: 11, size: "md" },
  { name: "MUSEUM DISTRICT",   lat: 29.7222, lng: -95.3888, minZoom: 11, size: "md" },
  { name: "EAST DOWNTOWN",     lat: 29.7492, lng: -95.3422, minZoom: 11, size: "md" },
  { name: "MEMORIAL",          lat: 29.7642, lng: -95.4768, minZoom: 11, size: "md" },
  { name: "SPRING BRANCH",     lat: 29.7882, lng: -95.4748, minZoom: 11, size: "md" },
  { name: "GREENWAY PLAZA",    lat: 29.7382, lng: -95.4338, minZoom: 11, size: "md" },
  // Detailed neighbourhoods — appear at zoom 12
  { name: "THIRD WARD",                lat: 29.7285, lng: -95.3645, minZoom: 12, size: "sm" },
  { name: "FIFTH WARD",                lat: 29.7780, lng: -95.3430, minZoom: 12, size: "sm" },
  { name: "FOURTH WARD",               lat: 29.7545, lng: -95.3850, minZoom: 12, size: "sm" },
  { name: "KASHMERE GARDENS",          lat: 29.8052, lng: -95.3340, minZoom: 12, size: "sm" },
  { name: "PLEASANTVILLE",             lat: 29.7650, lng: -95.3250, minZoom: 12, size: "sm" },
  { name: "GREATER EASTWOOD",          lat: 29.7250, lng: -95.3250, minZoom: 12, size: "sm" },
  { name: "GULFGATE · PINE VALLEY",    lat: 29.7050, lng: -95.3230, minZoom: 12, size: "sm" },
  { name: "AFTON OAKS · RIVER OAKS",   lat: 29.7400, lng: -95.4280, minZoom: 12, size: "sm" },
  { name: "MEADOWS · WILLOW BEND",     lat: 29.6990, lng: -95.4750, minZoom: 12, size: "sm" },
  { name: "ASTRODOME NEIGHBORHOOD",    lat: 29.6910, lng: -95.4015, minZoom: 12, size: "sm" },
  { name: "GOLFCREST",                 lat: 29.6800, lng: -95.3050, minZoom: 12, size: "sm" },
  { name: "SOUTH PARK",                lat: 29.6850, lng: -95.3720, minZoom: 12, size: "sm" },
  { name: "CENTRAL SOUTHWEST",         lat: 29.6580, lng: -95.4500, minZoom: 12, size: "sm" },
  { name: "MINNETEX",                  lat: 29.6710, lng: -95.3620, minZoom: 12, size: "sm" },
  { name: "SHADOW CREEK RANCH",        lat: 29.6050, lng: -95.4390, minZoom: 12, size: "sm" },
  // Fine-grain detail — appear at zoom 13
  { name: "UPPER KIRBY",               lat: 29.7300, lng: -95.4150, minZoom: 13, size: "sm" },
  { name: "WASHINGTON CORRIDOR",       lat: 29.7730, lng: -95.4070, minZoom: 13, size: "sm" },
  { name: "RICE VILLAGE",              lat: 29.7188, lng: -95.4180, minZoom: 13, size: "sm" },
  { name: "OST · SOUTH UNION",         lat: 29.6975, lng: -95.3680, minZoom: 13, size: "sm" },
  { name: "SUNNYSIDE",                 lat: 29.6825, lng: -95.3600, minZoom: 13, size: "sm" },
];

function createAreaLabelIcon(name: string, size: "md" | "sm"): L.DivIcon {
  const fontSize = size === "md" ? "10px" : "9px";
  const fontWeight = size === "md" ? "600" : "500";
  const ls = size === "md" ? "0.12em" : "0.09em";
  return L.divIcon({
    className: "",
    html: `<span style="font-family:'DM Sans',sans-serif;font-size:${fontSize};font-weight:${fontWeight};letter-spacing:${ls};color:rgba(14,31,64,0.75);text-shadow:0 0 3px rgba(255,255,255,1),0 0 6px rgba(255,255,255,0.85);white-space:nowrap;pointer-events:none;user-select:none;display:inline-block;transform:translate(-50%,-50%)">${name}</span>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function NeighborhoodLabels() {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const visible = AREA_LABELS.filter(l => zoom >= l.minZoom);
  return (
    <>
      {visible.map((l, i) => (
        <Marker
          key={i}
          position={[l.lat, l.lng]}
          icon={createAreaLabelIcon(l.name, l.size)}
          zIndexOffset={-500}
        />
      ))}
    </>
  );
}

interface NominatimResult {
  place_id: number | string;
  display_name: string;
  lat: string;
  lon: string;
  type: string;
  class: string;
  address?: { road?: string; city?: string; town?: string; suburb?: string; village?: string; county?: string; state?: string; postcode?: string; country?: string };
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_id?: number;
    name?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    type?: string;
    osm_type?: string;
  };
}

function extractCityName(addr?: NominatimResult["address"]): string | null {
  if (!addr) return null;
  const place = addr.city || addr.town || addr.village || addr.suburb || addr.county;
  if (!place) return null;
  return addr.state ? `${place}, ${addr.state.replace(/^.+? /, "")}` : place;
}

function searchPinSvg(type: string, osmClass: string): string {
  const s = (d: string) =>
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const t = type.toLowerCase();
  const c = osmClass.toLowerCase();

  if (["hospital","clinic","doctors","pharmacy","dentist","veterinary","nursing_home"].includes(t))
    return s('<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>');

  if (["restaurant","cafe","fast_food","food_court","ice_cream","deli","bakery","biergarten_restaurant"].includes(t) || c === "restaurant")
    return s('<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>');

  if (["bar","pub","nightclub","biergarten"].includes(t))
    return s('<path d="M17 11H3a1 1 0 0 0-1 1v3c0 2.76 4 5 4 5h8s4-2.24 4-5v-3a1 1 0 0 0-1-1z"/><path d="M9 3v3"/><path d="M5 3v3"/><path d="M13 3v3"/><path d="M17 3v3"/><path d="M6 11V6a6 6 0 0 1 12 0v5"/>');

  if (["hotel","motel","hostel","guest_house","apartment"].includes(t) || c === "tourism" && ["hotel","motel"].includes(t))
    return s('<path d="M3 22V8l9-6 9 6v14"/><path d="M9 22V12h6v10"/>');

  if (t === "parking" || (c === "amenity" && t === "parking"))
    return s('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/>');

  if (["school","university","college","kindergarten"].includes(t))
    return s('<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>');

  if (t === "library")
    return s('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>');

  if (["aerodrome","airport","airfield"].includes(t) || c === "aeroway")
    return s('<path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>');

  if (["museum","art_gallery","gallery","theatre","cinema"].includes(t))
    return s('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>');

  if (["church","mosque","synagogue","place_of_worship","cathedral"].includes(t))
    return s('<path d="M18 22V7l-6-5-6 5v15"/><path d="M9 22v-5h6v5"/><line x1="12" y1="7" x2="12" y2="1"/><line x1="9" y1="3" x2="15" y2="3"/>');

  if (["supermarket","mall","department_store","convenience","marketplace"].includes(t) || c === "shop")
    return s('<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>');

  if (["stadium","sports_centre","gym","fitness_centre","pitch","swimming_pool","golf_course"].includes(t))
    return s('<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>');

  if (["park","garden","nature_reserve","national_park","recreation_ground","forest"].includes(t) || c === "natural" || c === "leisure")
    return s('<path d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7z"/><path d="M12 9v4"/><path d="M9 11l3-3 3 3"/>');

  if (["fuel","charging_station"].includes(t))
    return s('<path d="M3 22V10l9-8 9 8v12"/><line x1="9" y1="22" x2="9" y2="12"/><line x1="15" y1="22" x2="15" y2="12"/><line x1="9" y1="12" x2="15" y2="12"/>');

  if (["bank","atm","bureau_de_change"].includes(t))
    return s('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>');

  if (t === "police")
    return s('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>');

  if (t === "fire_station")
    return s('<path d="M12 2c0 0-6 6-6 12a6 6 0 0 0 12 0c0-6-6-12-6-12z"/><path d="M12 12c0 0-3 2-3 5a3 3 0 0 0 6 0c0-3-3-5-3-5z"/>');

  // ── Class-level fallbacks: every OSM class guaranteed an icon ──
  if (c === "amenity")
    return s('<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="2" x2="6" y2="8"/><line x1="10" y1="2" x2="10" y2="8"/><line x1="14" y1="2" x2="14" y2="8"/>');

  if (c === "tourism")
    return s('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>');

  if (c === "highway")
    return s('<line x1="3" y1="12" x2="21" y2="12"/><polyline points="14 5 21 12 14 19"/>');

  if (c === "railway")
    return s('<rect x="4" y="3" width="16" height="13" rx="2"/><path d="M4 11h16"/><path d="M12 3v8"/><path d="M8 16l-2 5"/><path d="M16 16l2 5"/><path d="M6 21h12"/>');

  if (c === "waterway")
    return s('<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>');

  if (c === "natural")
    return s('<path d="M17 8c0-4.97-4-9-9-9"/><path d="M11 21H4a2 2 0 0 1-2-2c0-3.51 2.52-6.44 6-6.93V10a6 6 0 0 1 6-6 6 6 0 0 1 6 6c0 4-4 6-4 6v1c0 3.31-2.69 6-6 6z"/><path d="M8 21v-9"/>');

  if (c === "leisure")
    return s('<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>');

  if (c === "office")
    return s('<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>');

  if (c === "craft")
    return s('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>');

  if (c === "emergency" || c === "healthcare")
    return s('<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>');

  if (c === "historic")
    return s('<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>');

  if (c === "military")
    return s('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>');

  if (c === "place")
    return s('<line x1="3" y1="22" x2="21" y2="22"/><rect x="4" y="14" width="4" height="8"/><rect x="10" y="9" width="4" height="13"/><rect x="16" y="5" width="4" height="17"/>');

  if (c === "man_made" || c === "power")
    return s('<line x1="2" y1="22" x2="22" y2="22"/><polyline points="6 22 6 12 10 12 10 7 14 7 14 12 18 12 18 22"/><line x1="10" y1="7" x2="10" y2="2"/><line x1="14" y1="7" x2="14" y2="2"/><line x1="8" y1="2" x2="16" y2="2"/>');

  if (c === "building")
    return s('<rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M16 10h.01"/>');

  if (c === "landuse")
    return s('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>');

  if (c === "boundary")
    return s('<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>');

  return s('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>');
}

function createSearchPinIcon(type: string, osmClass: string): L.DivIcon {
  const innerSvg = searchPinSvg(type, osmClass);
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 4px 12px rgba(56,189,248,0.45))">
      <div style="width:42px;height:42px;border-radius:13px;background:linear-gradient(145deg,rgba(255,255,255,0.97) 0%,rgba(224,242,255,0.92) 100%);border:2px solid rgba(56,189,248,0.65);box-shadow:inset 0 1px 0 rgba(255,255,255,1),0 0 0 3px rgba(56,189,248,0.18);display:flex;align-items:center;justify-content:center;color:#0c4a6e;backdrop-filter:blur(8px)">${innerSvg}</div>
      <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:9px solid rgba(56,189,248,0.75);margin-top:-1px"></div>
    </div>`,
    iconSize: [42, 53],
    iconAnchor: [21, 53],
  });
}

function shortLabel(r: NominatimResult): string {
  const parts = r.display_name.split(",");
  return parts.slice(0, 3).join(",").trim();
}

/** Detect "place in city" / "place near city" patterns in free-text queries */
function parseQueryCity(q: string): { place: string; cityHint: string } {
  const m = q.match(/^(.+?)\s+(?:in|near|at|around)\s+(.+)$/i);
  if (m) return { place: m[1].trim(), cityHint: m[2].trim() };
  return { place: q.trim(), cityHint: "" };
}

/** Convert a Photon GeoJSON feature into a NominatimResult-shaped object */
function photonToNom(f: PhotonFeature, idx: number): NominatimResult {
  const p = f.properties;
  const displayParts = [p.name, p.city || p.county, p.state, p.country].filter(Boolean);
  return {
    place_id: `photon-${p.osm_id ?? idx}`,
    lat: String(f.geometry.coordinates[1]),
    lon: String(f.geometry.coordinates[0]),
    display_name: displayParts.join(", "),
    type: p.type ?? "",
    class: p.osm_type ?? "",
    address: { city: p.city, county: p.county, state: p.state, country: p.country },
  };
}

type SpotStatus = "available" | "booked" | "almost";
function getSpotStatus(_id: string): SpotStatus {
  return "available";
}

function idHash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}
function getSpotHours(_id: string): { openHour: number; closeHour: number } {
  return { openHour: 0, closeHour: 24 };
}

const _boltSvg = `<svg width="9" height="11" viewBox="0 0 13 17" fill="rgba(255,255,255,0.95)" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 0 3px rgba(255,255,255,0.80)) drop-shadow(0 0 6px rgba(140,205,255,0.65))"><path d="M8.5 0L1 10h5.2L5 17L13 7H7.8L8.5 0z"/></svg>`;

let _pinIdCounter = 0;

// Teardrop map pin — classic drop shape (arc over top + bezier taper to tip)
function createPinIcon(_price: string, featured: boolean, selected: boolean, nearbyHighlight = false, status: SpotStatus = "available"): L.DivIcon {
  const uid = ++_pinIdCounter;

  // ── Per-state colours & sizes ─────────────────────────────────────────────
  let r: number, fill: string, strokeCol: string, strokeW = 1.6;
  let glowDefs = "", glowAttr = "", innerHtml = "", ringHtml = "";

  if (selected) {
    r = 14; fill = "#8DD63F"; strokeCol = "rgba(255,255,255,0.95)"; strokeW = 2.5;
  } else if (nearbyHighlight) {
    r = 11; fill = "#8DD63F"; strokeCol = "rgba(141,214,63,0.75)";
  } else if (status === "booked") {
    r = 9;  fill = "#8DD63F"; strokeCol = "rgba(255,255,255,0.80)";
  } else if (status === "almost") {
    r = 9;  fill = "#8DD63F"; strokeCol = "rgba(141,214,63,0.75)";
  } else if (featured) {
    r = 11; fill = "#8DD63F"; strokeCol = "rgba(255,255,255,0.90)";
  } else {
    r = 9;  fill = "#8DD63F"; strokeCol = "rgba(255,255,255,0.80)";
  }

  // ── Geometry ──────────────────────────────────────────────────────────────
  const pad    = 3 + (selected ? 6 : 0);
  const tipLen = selected ? 14 : nearbyHighlight ? 12 : 10;
  const totalW = r * 2 + pad * 2;
  const cx     = totalW / 2;
  const cy     = r + pad;           // centre of the round head
  const tipY   = cy + r + tipLen;
  const totalH = tipY + 3;

  // Classic pin: smooth cubic-bezier sides converging to a sharp tip.
  // The "shoulder" starts at ±90° of the circle and tapers inward.
  const lx = +(cx - r).toFixed(2), ly = +(cy).toFixed(2);          // left equator
  const rx2 = +(cx + r).toFixed(2);                                  // right equator
  const c1x = +(cx - r * 0.55).toFixed(2), c1y = +(cy + r + tipLen * 0.6).toFixed(2);
  const c2x = +(cx + r * 0.55).toFixed(2);
  // Path: tip → left equator (cubic) → full arc over top → right equator (cubic) → back to tip
  const path = [
    `M ${cx} ${tipY}`,
    `C ${c1x} ${c1y} ${lx} ${+(cy + r * 0.55).toFixed(2)} ${lx} ${ly}`,
    `A ${r} ${r} 0 1 1 ${rx2} ${ly}`,
    `C ${rx2} ${+(cy + r * 0.55).toFixed(2)} ${c2x} ${c1y} ${cx} ${tipY}`,
    `Z`,
  ].join(" ");

  // Glossy highlight — upper-left inside the head
  const hlCx = +(cx - r * 0.26).toFixed(2), hlCy = +(cy - r * 0.28).toFixed(2);
  const hlRx = +(r * 0.32).toFixed(2),      hlRy = +(r * 0.20).toFixed(2);

  // Selection ring halo
  if (selected) {
    ringHtml = `<circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="none" stroke="rgba(141,214,63,0.35)" stroke-width="2.5"/>`;
  }

  // White dot centre (keeps pins readable at small size)
  if (!selected) {
    innerHtml = `<circle cx="${cx}" cy="${cy}" r="${+(r * 0.28).toFixed(2)}" fill="rgba(255,255,255,0.70)"/>`;
  }

  const shId = `sh${uid}`;
  const shadowDef = `<filter id="${shId}" x="-40%" y="-20%" width="180%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="rgba(0,0,0,0.40)"/></filter>`;

  const html = `<svg width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" xmlns="http://www.w3.org/2000/svg">
    <defs>${shadowDef}${glowDefs}</defs>
    ${ringHtml}
    <g filter="url(#${shId})" ${glowAttr}>
      <path d="${path}" fill="${fill}" stroke="${strokeCol}" stroke-width="${strokeW}" stroke-linejoin="round"/>
    </g>
    <ellipse cx="${hlCx}" cy="${hlCy}" rx="${hlRx}" ry="${hlRy}" fill="rgba(255,255,255,0.45)" transform="rotate(-28 ${hlCx} ${hlCy})"/>
    ${innerHtml}
  </svg>`;

  return L.divIcon({
    className: "",
    html,
    iconSize: [totalW, totalH],
    iconAnchor: [cx, totalH],
  });
}

const userDotIcon = L.divIcon({
  className: "",
  html: `<div style="width:16px;height:16px;border-radius:50%;background:#3B82F6;border:3px solid #fff;box-shadow:0 0 0 5px rgba(59,130,246,0.25);"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

function MapRefSetter({ mapRef }: { mapRef: React.MutableRefObject<L.Map | null> }) {
  const map = useMap();
  useEffect(() => {
    mapRef.current = map;
    // After mount, call invalidateSize so Leaflet recalculates container dimensions.
    // This is necessary because the phone-frame container uses CSS flex and the map
    // element's pixel size may not be fully resolved by the time Leaflet initialises.
    map.whenReady(() => { map.invalidateSize(); });
  }, [map]);
  return null;
}

interface ArcPath { id: number; x1: number; y1: number; x2: number; y2: number; }

function NearbyArcBridge({ active, origin, spots, onPaths }: {
  active: boolean;
  origin: [number, number];
  spots: typeof SPOTS;
  onPaths: (paths: ArcPath[]) => void;
}) {
  const map = useMap();
  const zooming = useRef(false);
  const raf = useRef(0);
  function recompute() {
    if (zooming.current) return;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      if (!active || spots.length === 0) { onPaths([]); return; }
      const op = map.latLngToContainerPoint(origin);
      onPaths(spots.map(s => {
        const sp = map.latLngToContainerPoint([s.lat, s.lng]);
        return { id: s.id, x1: sp.x, y1: sp.y, x2: op.x, y2: op.y };
      }));
    });
  }
  useMapEvents({
    move: recompute,
    zoomstart: () => { zooming.current = true; },
    zoomend:   () => { zooming.current = false; recompute(); },
  });
  useEffect(() => { recompute(); }, [active, origin, spots]);
  return null;
}

function MapController({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    map.flyTo(center, zoom, { duration: 1.0 });
  }, [center, zoom]);
  return null;
}

function MapMoveDetector({ onUserMove }: { onUserMove: () => void }) {
  const interacted = useRef(false);
  useMapEvents({
    dragstart:  () => { interacted.current = true; },
    touchstart: () => { interacted.current = true; },
    moveend: () => {
      if (interacted.current) { interacted.current = false; onUserMove(); }
    },
    zoomend: () => {
      if (interacted.current) { interacted.current = false; onUserMove(); }
    },
  });
  return null;
}

// ── Clearbit Business Logo Markers ────────────────────────────────────────────

const BRAND_DOMAINS: Record<string, string> = {
  "mcdonald's": "mcdonalds.com", "mcdonalds": "mcdonalds.com",
  "starbucks": "starbucks.com",
  "subway": "subway.com",
  "taco bell": "tacobell.com",
  "burger king": "burgerking.com",
  "wendy's": "wendys.com", "wendys": "wendys.com",
  "chick-fil-a": "chick-fil-a.com",
  "chipotle": "chipotle.com", "chipotle mexican grill": "chipotle.com",
  "domino's": "dominos.com", "domino's pizza": "dominos.com",
  "pizza hut": "pizzahut.com",
  "papa john's": "papajohns.com", "papa johns": "papajohns.com",
  "panera bread": "panerabread.com", "panera": "panerabread.com",
  "dunkin'": "dunkindonuts.com", "dunkin": "dunkindonuts.com",
  "dunkin' donuts": "dunkindonuts.com", "dunkin donuts": "dunkindonuts.com",
  "krispy kreme": "krispykreme.com",
  "sonic": "sonicdrivein.com", "sonic drive-in": "sonicdrivein.com",
  "dairy queen": "dairyqueen.com",
  "whataburger": "whataburger.com",
  "in-n-out burger": "in-n-out.com", "in-n-out": "in-n-out.com",
  "five guys": "fiveguys.com",
  "shake shack": "shakeshack.com",
  "wingstop": "wingstop.com",
  "popeyes": "popeyes.com", "popeyes louisiana kitchen": "popeyes.com",
  "kfc": "kfc.com",
  "panda express": "pandaexpress.com",
  "ihop": "ihop.com",
  "denny's": "dennys.com", "dennys": "dennys.com",
  "applebee's": "applebees.com", "applebees": "applebees.com",
  "olive garden": "olivegarden.com",
  "red lobster": "redlobster.com",
  "outback steakhouse": "outback.com",
  "chili's": "chilis.com", "chilis": "chilis.com",
  "hooters": "hooters.com",
  "raising cane's": "raisingcanes.com", "raising canes": "raisingcanes.com",
  "jack in the box": "jackinthebox.com",
  "carl's jr": "carlsjr.com", "carl's jr.": "carlsjr.com",
  "hardee's": "hardees.com",
  "jimmy john's": "jimmyjohns.com",
  "jersey mike's": "jerseymikes.com",
  "firehouse subs": "firehousesubs.com",
  "qdoba": "qdoba.com",
  "del taco": "deltaco.com",
  "bojangles": "bojangles.com",
  "culver's": "culvers.com",
  "little caesars": "littlecaesars.com", "little caesars pizza": "littlecaesars.com",
  "cook out": "cookout.com",
  "steak 'n shake": "steaknshake.com",
  "dutch bros": "dutchbros.com", "dutch bros coffee": "dutchbros.com",
  "peet's coffee": "peets.com",
  "tim hortons": "timhortons.com",
  "caribou coffee": "cariboucoffee.com",
  "chase": "chase.com", "chase bank": "chase.com",
  "wells fargo": "wellsfargo.com",
  "bank of america": "bankofamerica.com",
  "citibank": "citi.com", "citi": "citi.com",
  "us bank": "usbank.com", "u.s. bank": "usbank.com",
  "truist": "truist.com",
  "regions bank": "regions.com", "regions": "regions.com",
  "pnc bank": "pnc.com", "pnc": "pnc.com",
  "td bank": "td.com",
  "capital one": "capitalone.com",
  "fifth third bank": "53.com", "fifth third": "53.com",
  "walmart": "walmart.com", "walmart supercenter": "walmart.com",
  "target": "target.com",
  "kroger": "kroger.com",
  "h-e-b": "heb.com", "heb": "heb.com", "h.e.b.": "heb.com",
  "publix": "publix.com",
  "safeway": "safeway.com",
  "albertsons": "albertsons.com",
  "aldi": "aldi.us",
  "trader joe's": "traderjoes.com", "trader joes": "traderjoes.com",
  "whole foods": "wholefoodsmarket.com", "whole foods market": "wholefoodsmarket.com",
  "costco": "costco.com", "costco wholesale": "costco.com",
  "sam's club": "samsclub.com",
  "meijer": "meijer.com",
  "hy-vee": "hy-vee.com", "hyvee": "hy-vee.com",
  "winn-dixie": "winndixie.com",
  "food lion": "foodlion.com",
  "harris teeter": "harristeeter.com",
  "sprouts": "sprouts.com", "sprouts farmers market": "sprouts.com",
  "cvs": "cvs.com", "cvs pharmacy": "cvs.com",
  "walgreens": "walgreens.com",
  "rite aid": "riteaid.com",
  "7-eleven": "7-eleven.com", "7eleven": "7-eleven.com",
  "shell": "shell.com",
  "chevron": "chevron.com",
  "exxon": "exxon.com", "mobil": "exxon.com",
  "bp": "bp.com",
  "circle k": "circlek.com",
  "wawa": "wawa.com",
  "sheetz": "sheetz.com",
  "kwik trip": "kwiktrip.com",
  "casey's": "caseys.com", "casey's general store": "caseys.com",
  "speedway": "speedway.com",
  "nordstrom": "nordstrom.com",
  "macy's": "macys.com", "macys": "macys.com",
  "jcpenney": "jcpenney.com",
  "kohl's": "kohls.com", "kohls": "kohls.com",
  "dillard's": "dillards.com",
  "tj maxx": "tjmaxx.com", "t.j. maxx": "tjmaxx.com",
  "marshalls": "marshalls.com",
  "ross": "rossstores.com", "ross dress for less": "rossstores.com",
  "burlington": "burlington.com", "burlington coat factory": "burlington.com",
  "gap": "gap.com",
  "h&m": "hm.com",
  "zara": "zara.com",
  "old navy": "oldnavy.com",
  "banana republic": "bananarepublic.com",
  "forever 21": "forever21.com",
  "american eagle": "ae.com", "american eagle outfitters": "ae.com",
  "hollister": "hollisterco.com",
  "abercrombie & fitch": "abercrombie.com",
  "nike": "nike.com",
  "adidas": "adidas.com",
  "under armour": "underarmour.com",
  "academy sports": "academy.com", "academy sports + outdoors": "academy.com",
  "dick's sporting goods": "dickssportinggoods.com",
  "bass pro shops": "basspro.com",
  "rei": "rei.com",
  "apple store": "apple.com", "apple": "apple.com",
  "best buy": "bestbuy.com",
  "verizon": "verizon.com",
  "at&t": "att.com",
  "t-mobile": "t-mobile.com", "tmobile": "t-mobile.com",
  "marriott": "marriott.com",
  "hilton": "hilton.com",
  "holiday inn": "holidayinn.com", "holiday inn express": "ihg.com",
  "hyatt": "hyatt.com",
  "doubletree": "hilton.com", "hampton inn": "hilton.com",
  "courtyard": "marriott.com", "residence inn": "marriott.com",
  "four seasons": "fourseasons.com",
  "best western": "bestwestern.com",
  "motel 6": "motel6.com",
  "la quinta": "laquinta.com",
  "home depot": "homedepot.com", "the home depot": "homedepot.com",
  "lowe's": "lowes.com", "lowes": "lowes.com",
  "ace hardware": "acehardware.com",
  "petco": "petco.com",
  "petsmart": "petsmart.com",
  "dollar tree": "dollartree.com",
  "dollar general": "dollargeneral.com",
  "family dollar": "familydollar.com",
  "five below": "fivebelow.com",
  "big lots": "biglots.com",
  "hobby lobby": "hobbylobby.com",
  "michaels": "michaels.com",
  "ikea": "ikea.com",
  "barnes & noble": "barnesandnoble.com",
  "gamestop": "gamestop.com",
  "sephora": "sephora.com",
  "ulta": "ulta.com", "ulta beauty": "ulta.com",
  "great clips": "greatclips.com",
  "supercuts": "supercuts.com",
  "sport clips": "sportclips.com",
  "amc": "amctheatres.com", "amc theatres": "amctheatres.com",
  "regal": "regmovies.com", "regal cinemas": "regmovies.com",
  "cinemark": "cinemark.com",
  "planet fitness": "planetfitness.com",
  "la fitness": "lafitness.com",
  "anytime fitness": "anytimefitness.com",
  "gold's gym": "goldsgym.com",
  "equinox": "equinox.com",
  "crunch": "crunch.com", "crunch fitness": "crunch.com",
  "orangetheory fitness": "orangetheory.com", "orange theory": "orangetheory.com",
  "snap fitness": "snapfitness.com",
  "jiffy lube": "jiffylube.com",
  "midas": "midas.com",
  "meineke": "meineke.com",
  "autozone": "autozone.com",
  "o'reilly auto parts": "oreillyauto.com", "oreilly auto parts": "oreillyauto.com",
  "advance auto parts": "advanceautoparts.com",
  "carmax": "carmax.com",
  "enterprise": "enterprise.com", "enterprise rent-a-car": "enterprise.com",
  "hertz": "hertz.com",
  "avis": "avis.com",
  "fedex": "fedex.com",
  "ups store": "theupsstore.com", "the ups store": "theupsstore.com",
  "usps": "usps.com", "post office": "usps.com",
};

function getBrandDomain(name: string, tags: Record<string, string>): string | null {
  const siteTag = tags["brand:website"] || tags["contact:website"] || tags["website"];
  if (siteTag) {
    try {
      const url = new URL(siteTag.startsWith("http") ? siteTag : "https://" + siteTag);
      return url.hostname.replace(/^www\./, "");
    } catch {}
  }
  const lower = name.toLowerCase().trim();
  if (BRAND_DOMAINS[lower]) return BRAND_DOMAINS[lower];
  const brandTag = (tags["brand"] || "").toLowerCase().trim();
  if (brandTag && BRAND_DOMAINS[brandTag]) return BRAND_DOMAINS[brandTag];
  return null;
}

// ── Category icons for business markers ──────────────────────────────────────
function _ico(d: string) {
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
}
const _CAT: Record<string, { grad: string; icon: string }> = {
  cafe:         { grad: "linear-gradient(145deg,#92400e,#78350f)", icon: _ico('<path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>') },
  restaurant:   { grad: "linear-gradient(145deg,#dc2626,#991b1b)", icon: _ico('<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>') },
  fast_food:    { grad: "linear-gradient(145deg,#ea580c,#c2410c)", icon: _ico('<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>') },
  pharmacy:     { grad: "linear-gradient(145deg,#db2777,#9d174d)", icon: _ico('<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>') },
  hospital:     { grad: "linear-gradient(145deg,#e11d48,#9f1239)", icon: _ico('<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>') },
  doctors:      { grad: "linear-gradient(145deg,#e11d48,#9f1239)", icon: _ico('<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>') },
  dentist:      { grad: "linear-gradient(145deg,#e11d48,#9f1239)", icon: _ico('<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>') },
  supermarket:  { grad: "linear-gradient(145deg,#16a34a,#14532d)", icon: _ico('<path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="23" y2="6"/><path d="M16 10a4 4 0 01-8 0"/>') },
  convenience:  { grad: "linear-gradient(145deg,#d97706,#92400e)", icon: _ico('<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39A2 2 0 009.66 16h9.72a2 2 0 001.97-1.67L23 6H6"/>') },
  department_store: { grad: "linear-gradient(145deg,#f59e0b,#b45309)", icon: _ico('<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39A2 2 0 009.66 16h9.72a2 2 0 001.97-1.67L23 6H6"/>') },
  mall:         { grad: "linear-gradient(145deg,#f59e0b,#b45309)", icon: _ico('<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39A2 2 0 009.66 16h9.72a2 2 0 001.97-1.67L23 6H6"/>') },
  electronics:  { grad: "linear-gradient(145deg,#2563eb,#1e3a8a)", icon: _ico('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>') },
  clothes:      { grad: "linear-gradient(145deg,#7c3aed,#4c1d95)", icon: _ico('<path d="M20.38 3.46L16 2l-4 4-4-4-4.38 1.46a2 2 0 00-1.32 2.28l2 8A2 2 0 006.24 15H9v6h6v-6h2.76a2 2 0 001.94-1.26l2-8a2 2 0 00-1.32-2.28z"/>') },
  sports:       { grad: "linear-gradient(145deg,#0891b2,#0e7490)", icon: _ico('<circle cx="12" cy="12" r="10"/><path d="M4.93 4.93l14.14 14.14"/><path d="M4.93 19.07L19.07 4.93"/>') },
  hardware:     { grad: "linear-gradient(145deg,#57534e,#292524)", icon: _ico('<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>') },
  bank:         { grad: "linear-gradient(145deg,#1d4ed8,#1e3a8a)", icon: _ico('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>') },
  atm:          { grad: "linear-gradient(145deg,#1d4ed8,#1e3a8a)", icon: _ico('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>') },
  fuel:         { grad: "linear-gradient(145deg,#475569,#1e293b)", icon: _ico('<line x1="3" y1="22" x2="15" y2="22"/><line x1="4" y1="9" x2="14" y2="9"/><path d="M14 22V4a2 2 0 00-2-2H6a2 2 0 00-2 2v18"/><path d="M14 13h2a2 2 0 012 2v3a1 1 0 002 0V9"/>') },
  hotel:        { grad: "linear-gradient(145deg,#7c3aed,#5b21b6)", icon: _ico('<path d="M2 4v16"/><path d="M22 4v16"/><path d="M2 8h20"/><path d="M6 12h4a2 2 0 012 2v4H4v-4a2 2 0 012-2z"/>') },
  bar:          { grad: "linear-gradient(145deg,#b45309,#78350f)", icon: _ico('<path d="M17 11h1a3 3 0 010 6h-1"/><path d="M9 12v6"/><path d="M13 12v6"/><path d="M14 2c1 0 3 .5 3 2v8H6V4c0-1.5 1-2 3-2h5z"/>') },
  pub:          { grad: "linear-gradient(145deg,#b45309,#78350f)", icon: _ico('<path d="M17 11h1a3 3 0 010 6h-1"/><path d="M9 12v6"/><path d="M13 12v6"/><path d="M14 2c1 0 3 .5 3 2v8H6V4c0-1.5 1-2 3-2h5z"/>') },
  nightclub:    { grad: "linear-gradient(145deg,#7c3aed,#4c1d95)", icon: _ico('<circle cx="9" cy="18" r="3"/><circle cx="15" cy="15" r="3"/><path d="M12 12V3"/><path d="M9 6l3-3 3 3"/>') },
  cinema:       { grad: "linear-gradient(145deg,#4f46e5,#3730a3)", icon: _ico('<path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>') },
  bakery:       { grad: "linear-gradient(145deg,#c2410c,#7c2d12)", icon: _ico('<path d="M12 2a10 10 0 100 20A10 10 0 0012 2z"/><path d="M12 8v4l2 2"/>') },
  deli:         { grad: "linear-gradient(145deg,#dc2626,#991b1b)", icon: _ico('<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>') },
};
const _CAT_DEFAULT = { grad: "linear-gradient(145deg,#334155,#0f172a)", icon: _ico('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>') };

function bizCategoryIcon(_name: string, amenity: string, shop: string): L.DivIcon {
  const key = amenity || shop;
  const cat = _CAT[key] ?? _CAT_DEFAULT;
  const html = [
    `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:none;">`,
    `<div style="width:32px;height:32px;border-radius:50%;background:${cat.grad};`,
    `box-shadow:0 2px 8px rgba(0,0,0,0.35),inset 0 1px 0 rgba(255,255,255,0.28);`,
    `display:flex;align-items:center;justify-content:center;">${cat.icon}</div>`,
    `</div>`,
  ].join("");
  return L.divIcon({ className: "", html, iconSize: [32, 32], iconAnchor: [16, 16] });
}

interface BizMarker { id: string; lat: number; lng: number; name: string; domain: string; amenity: string; shop: string; }
const _bizCache = new Map<string, BizMarker[]>();

function MapBusinessLogos({ onBizClick, enabled }: { onBizClick: (name: string, domain: string, lat: number, lng: number) => void; enabled: boolean }) {
  const map = useMap();
  const [markers, setMarkers] = useState<BizMarker[]>([]);
  const fetchingRef = useRef(false);
  const lastBboxRef = useRef("");
  const allFetchedRef = useRef<BizMarker[]>([]);

  // ~670 m grid cell — only the first recognised brand in each cell is shown
  const gridKey = (lat: number, lon: number) =>
    `${Math.round(lat / 0.006)}|${Math.round(lon / 0.006)}`;

  const cullToView = useCallback(() => {
    if (!enabled) { setMarkers([]); return; }
    if (!allFetchedRef.current.length) return;
    const b = map.getBounds();
    const visible = allFetchedRef.current.filter(m => b.contains([m.lat, m.lng]));
    setMarkers(visible);
  }, [map, enabled]);

  const fetchBiz = useCallback(async () => {
    if (!enabled) { allFetchedRef.current = []; setMarkers([]); lastBboxRef.current = ""; return; }
    const zoom = map.getZoom();
    if (zoom < 13) { allFetchedRef.current = []; setMarkers([]); lastBboxRef.current = ""; return; }
    const b = map.getBounds();
    const bbox = [b.getSouth().toFixed(2), b.getWest().toFixed(2), b.getNorth().toFixed(2), b.getEast().toFixed(2)].join(",");
    if (bbox === lastBboxRef.current) { cullToView(); return; }
    lastBboxRef.current = bbox;
    if (_bizCache.has(bbox)) {
      allFetchedRef.current = _bizCache.get(bbox)!;
      cullToView();
      return;
    }
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      // Query both nodes AND ways (ways cover big-box stores like Walmart/Target/HEB)
      const amenities = "restaurant|cafe|fast_food|bar|pub|bank|pharmacy|fuel|hotel|cinema|supermarket|convenience";
      const shops = "supermarket|convenience|electronics|department_store|mall|clothes|sports|hardware";
      const q = [
        `[out:json][timeout:20];`,
        `(`,
        `node["name"]["amenity"~"${amenities}"](${bbox});`,
        `node["name"]["shop"~"${shops}"](${bbox});`,
        `node["name"]["brand"](${bbox});`,
        `way["name"]["amenity"~"${amenities}"](${bbox});`,
        `way["name"]["shop"~"${shops}"](${bbox});`,
        `way["name"]["brand"](${bbox});`,
        `);out center;`,
      ].join("");
      const res = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(q),
      });
      if (!res.ok) throw new Error("overpass " + res.status);
      const data = await res.json();
      const seen = new Set<string>(); // deduplicate exact same place
      const gridSeen = new Set<string>(); // one brand per ~670m cell
      const result: BizMarker[] = [];
      for (const el of data.elements as any[]) {
        // nodes have lat/lon directly; ways have a `center` object
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (!lat || !lon || !el.tags?.name) continue;
        const amenity = (el.tags.amenity ?? "") as string;
        const shop    = (el.tags.shop    ?? "") as string;
        const domain  = getBrandDomain(el.tags.name as string, el.tags as Record<string, string>) ?? "";
        // Only show markers that have proper OSM category tags (no brand-only markers)
        if (!amenity && !shop) continue;
        const key = `${el.tags.name as string}|${lat.toFixed(4)}|${lon.toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const gk = gridKey(lat, lon);
        if (gridSeen.has(gk)) continue; // skip if another brand already occupies this cell
        gridSeen.add(gk);
        result.push({ id: String(el.id), lat, lng: lon, name: el.tags.name, domain, amenity, shop });
      }
      _bizCache.set(bbox, result);
      allFetchedRef.current = result;
      cullToView();
    } catch (err) {
      console.warn("[MapBusinessLogos] fetch failed:", err);
    } finally {
      fetchingRef.current = false;
    }
  }, [map, cullToView, enabled]);

  useMapEvents({ move: cullToView, moveend: fetchBiz, zoomend: fetchBiz });
  useEffect(() => { fetchBiz(); }, [fetchBiz]);

  return (
    <>
      {markers.map(m => (
        <Marker
          key={m.id}
          position={[m.lat, m.lng]}
          icon={bizCategoryIcon(m.name, m.amenity, m.shop)}
          zIndexOffset={-5}
          eventHandlers={{
            click: (e) => {
              e.originalEvent.stopPropagation();
              onBizClick(m.name, m.domain, m.lat, m.lng);
            },
          }}
        />
      ))}
    </>
  );
}

function MapClickHandler({ onMapClick }: { onMapClick: () => void }) {
  useMapEvents({ click: onMapClick });
  return null;
}

function MapBoundsTracker({ onBoundsChange }: { onBoundsChange: (b: L.LatLngBounds) => void }) {
  const map = useMap();
  useMapEvents({
    moveend: () => onBoundsChange(map.getBounds()),
    zoomend: () => onBoundsChange(map.getBounds()),
  });
  useEffect(() => { onBoundsChange(map.getBounds()); }, []);
  return null;
}

// ── WebGL support check ─────────────────────────────────────────────────────
function supportsWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext &&
      (c.getContext("webgl") || c.getContext("experimental-webgl")));
  } catch { return false; }
}

// ── 3D Globe component (shown when no location / no city selected) ──────────
function GlobeView({
  spots,
  zoomTarget,
  onZoomedIn,
  onFallback,
  onSpotPicked,
}: {
  spots: Array<{ lat: number; lng: number; id: number; price: string }>;
  zoomTarget: [number, number] | null;
  onZoomedIn: () => void;
  onFallback: () => void;
  onSpotPicked: (lat: number, lng: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<any>(null);
  const zoomedRef = useRef(false);
  const onZoomedInRef = useRef(onZoomedIn);
  onZoomedInRef.current = onZoomedIn;
  const onFallbackRef = useRef(onFallback);
  onFallbackRef.current = onFallback;
  const onSpotPickedRef = useRef(onSpotPicked);
  onSpotPickedRef.current = onSpotPicked;

  useEffect(() => {
    if (!supportsWebGL()) { onFallbackRef.current(); return; }
    if (!containerRef.current) return;
    let cancelled = false;
    let altInterval: ReturnType<typeof setInterval> | null = null;

    import("globe.gl").then(({ default: Globe }) => {
      if (cancelled || !containerRef.current) return;
      const w = containerRef.current.clientWidth || 390;
      const h = containerRef.current.clientHeight || 780;

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const g = (Globe as any)()
          .width(w).height(h)
          // Natural day-side earth: vivid oceans, green land, visible cities
          .globeImageUrl("//unpkg.com/three-globe/example/img/earth-day.jpg")
          .bumpImageUrl("//unpkg.com/three-globe/example/img/earth-topology.png")
          .atmosphereColor("#7dd3fc")
          .atmosphereAltitude(0.18)
          .backgroundColor("#0a1628")
          .pointsData(spots)
          .pointLat("lat").pointLng("lng")
          .pointColor(() => "#8DD63F")
          .pointAltitude(0.025)
          .pointRadius(0.55)
          .pointLabel((d: any) => `<div style="background:#8DD63F;color:#0E1F40;padding:3px 8px;border-radius:8px;font-size:11px;font-weight:700;font-family:'DM Sans',sans-serif">${d.price}</div>`)
          .onPointClick((d: any) => {
            if (zoomedRef.current) return;
            onSpotPickedRef.current(d.lat, d.lng);
          })
          (containerRef.current);

        globeRef.current = g;
        g.pointOfView({ lat: 28, lng: -90, altitude: 2.2 });

        const ctrl = g.controls();
        ctrl.autoRotate = true;
        ctrl.autoRotateSpeed = 0.3;
        ctrl.enableZoom = true;

        // When user manually zooms in close enough, transition to Leaflet
        altInterval = setInterval(() => {
          if (cancelled || !g || zoomedRef.current) return;
          const pov = g.pointOfView();
          if (pov.altitude < 0.12) {
            zoomedRef.current = true;
            if (altInterval) clearInterval(altInterval);
            ctrl.autoRotate = false;
            onSpotPickedRef.current(pov.lat, pov.lng);
            // Trigger the crossfade transition after a short pause
            setTimeout(() => { if (!cancelled) onZoomedInRef.current(); }, 400);
          }
        }, 600);
      } catch {
        if (!cancelled) onFallbackRef.current();
      }
    }).catch(() => { if (!cancelled) onFallbackRef.current(); });

    return () => {
      cancelled = true;
      if (altInterval) clearInterval(altInterval);
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
  }, []);

  useEffect(() => {
    if (!zoomTarget || !globeRef.current || zoomedRef.current) return;
    zoomedRef.current = true;
    const g = globeRef.current;
    g.controls().autoRotate = false;
    // Remove dots immediately so they don't balloon into a cluster during zoom
    g.pointsData([]);
    // Zoom toward the target — we'll crossfade to Leaflet before reaching it
    g.pointOfView({ lat: zoomTarget[0], lng: zoomTarget[1], altitude: 0.35 }, 1400);
    // Start crossfade at 700ms — globe is still clean and mid-zoom
    setTimeout(() => onZoomedInRef.current(), 700);
  }, [zoomTarget]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", background: "#0a1628", position: "absolute", inset: 0 }}
    />
  );
}

type SheetState = "collapsed" | "half" | "full";

// ── Persisted location ────────────────────────────────────────────────────────
interface SavedLocation {
  mapCenter: [number, number];
  mapZoom: number;
  userPos: [number, number] | null;
  cityBias: { lat: number; lng: number } | null;
  cityName: string | null;
}
const LOC_KEY = "lilypad_location";
// Read once at module load — used only to seed initial useState values
let _savedLoc: SavedLocation | null = null;
try {
  const raw = localStorage.getItem(LOC_KEY);
  if (raw) _savedLoc = JSON.parse(raw) as SavedLocation;
} catch { /* ignore */ }

export default function FindPage() {
  const { goTo, state, setState: setAppState } = useApp();
  const { user, profile, role, signOut: authSignOut } = useAuth();
  // Non-admin/staff users see a Coming Soon screen instead of the live map
  const comingSoon = role !== "admin" && role !== "staff" && !state.adminPreview;
  const [spots, setSpots] = useState<SpotRecord[]>([]);

  useEffect(() => {
    fetch("/api/spots")
      .then(r => r.ok ? r.json() : null)
      .then((data: unknown) => {
        if (Array.isArray(data) && data.length > 0) {
          const mapped = (data as Record<string, unknown>[]).map(s => ({
            id:        String(s.id),
            price:     s.price_per_hr ? `$${s.price_per_hr}/hr` : "$4/hr",
            addr:      String(s.address || s.addr || "Houston, TX"),
            meta:      `${s.pad_type || "Driveway"} · nearby`,
            lat:       Number(s.lat),
            lng:       Number(s.lng),
            featured:  Boolean(s.featured),
            host_name: String(s.host_name || ""),
            photo_url:  String(s.photo_url || ""),
            photo_urls: Array.isArray(s.photo_urls) ? s.photo_urls as string[]
                        : (s.photo_url ? [String(s.photo_url)] : []),
          }));
          setSpots(mapped);
        }
      })
      .catch(() => { /* keep static SPOTS fallback */ });
  }, []);
  const [filter, setFilter] = useState("All");
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [sugOpen, setSugOpen] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [globeMode, setGlobeMode] = useState(false);
  const [globeFading, setGlobeFading] = useState(false);
  const [mapMounted, setMapMounted] = useState(true);
  const [mapOpacity, setMapOpacity] = useState(1);
  const [globeZoomTarget, setGlobeZoomTarget] = useState<[number, number] | null>(null);
  const globeModeRef = useRef(false);
  useEffect(() => { globeModeRef.current = globeMode; }, [globeMode]);
  const [mapCenter, setMapCenter] = useState<[number, number]>(_savedLoc?.mapCenter ?? CITY_CENTER);
  const [mapZoom, setMapZoom] = useState(_savedLoc?.mapZoom ?? NEIGHBORHOOD_ZOOM);
  const [userPos, setUserPos] = useState<[number, number] | null>(_savedLoc?.userPos ?? null);
  const [locating, setLocating] = useState(false);
  const [padsLocating, setPadsLocating] = useState(false);
  const [locDenied, setLocDenied] = useState(false);
  const [locPromptOpen, setLocPromptOpen] = useState(false);
  const [searchPin, setSearchPin] = useState<{ lat: number; lng: number; type: string; osmClass: string; name: string; domain: string } | null>(null);
  const [selectedSpot, setSelectedSpot] = useState<string | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [bookStartTs, setBookStartTs] = useState<number | null>(null);
  const [bookEndTs, setBookEndTs] = useState<number | null>(null);
  const [bookingConf, setBookingConf] = useState<{
    addr: string; padType: string; startTs: number; endTs: number; totalPrice: number; confNum: string;
  } | null>(null);
  const [nearbyMode, setNearbyMode] = useState(false);
  const [mapSearchOrigin, setMapSearchOrigin] = useState<[number, number] | null>(null);
  const [showHotspots, setShowHotspots] = useState(false);

  const [nearbyRadius, setNearbyRadius] = useState(2414);
  const [nearbyArcPaths, setNearbyArcPaths] = useState<ArcPath[]>([]);
  const [mapBounds, setMapBounds] = useState<L.LatLngBounds | null>(null);
  const [sheetState, setSheetState] = useState<SheetState>("half");
  const [sortMode, setSortMode] = useState<"distance" | "price">("distance");
  const [openFirst, setOpenFirst] = useState<boolean>(false);
  const [parkMode, setParkMode] = useState<"now" | "later">("now");
  const [laterDate, setLaterDate] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  });
  const [laterStart, setLaterStart] = useState<string>("09:00");
  const [laterEnd, setLaterEnd] = useState<string>("12:00");
  const [savedSpots, setSavedSpots] = useState<number[]>(() => {
    try { return JSON.parse(localStorage.getItem("lilypad_saved") ?? "[]") as number[]; } catch { return []; }
  });
  const [acctView, setAcctView] = useState<"menu" | "saved" | "account" | "support" | "bookings" | "manage-spot">("menu");
  const [drawerMode, setDrawerMode] = useState<"driver" | "lister">(() => {
    try { return (localStorage.getItem("lilypad_drawer_mode") as "driver" | "lister") || "driver"; } catch { return "driver"; }
  });
  const [myHostSpots, setMyHostSpots] = useState<SpotRecord[]>([]);
  const [managingSpot, setManagingSpot] = useState<SpotRecord | null>(null);
  const [hostBookings, setHostBookings] = useState<Array<{start_ts:number,total_price:number,status:string}>>([]);
  const [earningsRange, setEarningsRange] = useState<'D'|'W'|'M'|'Y'|'ALL'>('M');
  const [chartScrubIdx, setChartScrubIdx] = useState<number|null>(null);
  const [hostDashView, setHostDashView]   = useState<'main'|'earnings'>('main');
  const [supportView, setSupportView] = useState<"menu" | "thread">("menu");
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>(() => loadTickets());
  const supportUserId = useRef<string>(getOrCreateUserId());
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState("");
  const [shareToast, setShareToast] = useState<string | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  // Live ticket sync across same tab, other tabs, and embedded iframes
  // (via storage events, a same-tab CustomEvent, and a BroadcastChannel).
  useEffect(() => subscribeTickets(() => setSupportTickets(loadTickets())), []);

  // Reset support sub-view when switching out of support
  useEffect(() => {
    if (acctView !== "support") {
      setSupportView("menu");
      setActiveTicketId(null);
    } else {
      setSupportTickets(loadTickets());
    }
  }, [acctView]);

  // Persist drawer mode selection
  useEffect(() => {
    try { localStorage.setItem("lilypad_drawer_mode", drawerMode); } catch { /* ignore */ }
  }, [drawerMode]);

  // Fetch user's listed spots when lister mode is active
  useEffect(() => {
    if (drawerMode !== "lister" || !user) { setMyHostSpots([]); return; }
    supabase.from("spots").select("*").eq("auth_user_id", user.id).then(({ data }) => {
      if (data && data.length > 0) {
        setMyHostSpots((data as Record<string, unknown>[]).map(s => ({
          id: Number(s.id),
          price: s.price_per_hr ? `$${s.price_per_hr}/hr` : "$4/hr",
          addr: String(s.address || s.addr || "Houston, TX"),
          meta: `${s.pad_type || "Driveway"} · nearby`,
          lat: Number(s.lat),
          lng: Number(s.lng),
          featured: Boolean(s.featured),
          host_name: String(s.host_name || ""),
        })));
      } else {
        setMyHostSpots([]);
      }
    });
  }, [drawerMode, user]);

  // Fetch lister bookings for earnings chart when host mode is active
  useEffect(() => {
    if (drawerMode !== "lister" || !user) { setHostBookings([]); return; }
    fetch(`/api/bookings/lister/${user.id}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setHostBookings(data.map((b: any) => ({
            start_ts: b.start_ts ? Number(b.start_ts) : 0,
            total_price: Number(b.total_price) || 0,
            status: b.status || '',
          })));
        }
      }).catch(() => {});
  }, [drawerMode, user]);

  // Auto-scroll thread to bottom whenever the active ticket changes / new message arrives
  useEffect(() => {
    if (supportView === "thread" && threadEndRef.current) {
      threadEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [supportView, activeTicketId, supportTickets]);

  function currentSupportIdentity() {
    const first = profile?.first_name || state.drAns[0] || state.suAns[0] || "";
    const last  = profile?.last_name  || state.drAns[1] || state.suAns[1] || "";
    const email = profile?.email      || state.drAns[2] || state.suAns[2] || "";
    const fullName = `${first} ${last}`.trim();
    return {
      userName: fullName || "Guest",
      userEmail: email.trim(),
      accountType: (state.accountType === "padRenter" ? "padRenter" : "renter") as "padRenter" | "renter",
    };
  }

  function startNewChat() {
    const id = currentSupportIdentity();
    const now = Date.now();
    const t: SupportTicket = {
      id: makeId("t"),
      userId: supportUserId.current,
      userName: id.userName,
      userEmail: id.userEmail,
      accountType: id.accountType,
      subject: "Live chat with a rep",
      status: "open",
      openedByAgent: false,
      createdAt: now,
      updatedAt: now,
      messages: [{
        id: makeId("m"),
        from: "bot",
        text: "Hi there! You're connected with Lilypad support. A rep usually replies within a few minutes — what's going on?",
        ts: now,
      }],
    };
    const next = mutateTickets(cur => [t, ...cur.filter(x => x.id !== t.id)]);
    setSupportTickets(next);
    setActiveTicketId(t.id);
    setSupportView("thread");
    setChatDraft("");
  }

  function sendUserMessage(ticketId: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const now = Date.now();
    const msg = { id: makeId("m"), from: "user" as const, text: trimmed, ts: now };
    const next = mutateTickets(cur => cur.map(t => t.id === ticketId
      ? { ...t, status: "open" as const, openedByAgent: false, updatedAt: now, messages: [...t.messages, msg] }
      : t));
    setSupportTickets(next);
    setChatDraft("");
  }
  const photoInputRef = useRef<HTMLInputElement>(null);

  function onProfilePhotoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setAppState(s => ({ ...s, profilePhotoUrl: String(reader.result) }));
    reader.readAsDataURL(f);
  }
  function setAcctField(idx: number, value: string) {
    // Mirror to both renter (drAns) and host (suAns) stores so the info stays in sync
    setAppState(s => ({ ...s, drAns: { ...s.drAns, [idx]: value }, suAns: { ...s.suAns, [idx]: value } }));
  }
  function setVehicle(value: string) {
    setAppState(s => ({ ...s, drAns: { ...s.drAns, 4: value } }));
  }
  const toggleSave = (id: number) => {
    setSavedSpots(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      localStorage.setItem("lilypad_saved", JSON.stringify(next));
      return next;
    });
  };
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [cityBias, setCityBias] = useState<{ lat: number; lng: number } | null>(_savedLoc?.cityBias ?? null);
  const [cityName, setCityName] = useState<string | null>(_savedLoc?.cityName ?? null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const mapRef = useRef<L.Map | null>(null);
  const debounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nearbyFitRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cityInputRef = useRef<HTMLInputElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const sheetStateRef = useRef<SheetState>(sheetState);
  useEffect(() => { sheetStateRef.current = sheetState; }, [sheetState]);

  // CartoDB Voyager — natural colours (blue water, green parks, tan roads)
  const activeTile = VOYAGER_TILE;
  const dragStartY = useRef(0);
  const dragStartH = useRef(0);
  const dragOffsetRef = useRef(0);
  const lastDragY = useRef(0);
  const lastDragT = useRef(0);
  const dragVelocity = useRef(0); // px/ms, positive = moving DOWN
  // Sheet-wide drag (lets any downward swipe from anywhere on the sheet collapse it)
  const isDraggingRef = useRef(false);        // sync ref — avoids stale-closure issues
  const pendingSheetDragY = useRef(-1);       // -1 = no pending drag
  const pendingSheetDragH = useRef(0);
  const pendingSheetDragT = useRef(0); // timestamp of first touch — used for velocity

  // ── Page container ref — used to get real container height (not window.innerHeight) ──
  const pageRef = useRef<HTMLDivElement>(null);
  function pageH() { return pageRef.current?.offsetHeight ?? window.innerHeight; }

  // ── Account pull-down drawer ────────────────────────────────────────────────
  const ACCT_PEEK = 88; // px of handle visible at top when closed
  const [acctOpen, setAcctOpen] = useState(false);
  const [acctDragging, setAcctDragging] = useState(false);
  const [acctTransY, setAcctTransY] = useState(0); // translateY during drag
  const acctOpenRef = useRef(false);
  const acctDragStartY = useRef(0);
  const acctDragStartTransY = useRef(0);
  const acctVel = useRef(0);
  const acctLastY = useRef(0);
  const acctLastT = useRef(0);
  const acctSnapDir = useRef<"open" | "close">("close");

  useEffect(() => { acctOpenRef.current = acctOpen; }, [acctOpen]);

  // Reset acct sub-view when drawer closes
  useEffect(() => { if (!acctOpen) setAcctView("menu"); }, [acctOpen]);

  // External request to open the swipe-down drawer (e.g. user pressed Back on My Pads / Bookings)
  useEffect(() => {
    if (state.openAcctOnFind) {
      setSheetState("collapsed");
      setSelectedSpot(null);
      setAcctView("menu");
      setAcctOpen(true);
      acctOpenRef.current = true;
      setAppState(s => ({ ...s, openAcctOnFind: false }));
    }
  }, [state.openAcctOnFind, setAppState]);

  // Close drawer whenever the bottom sheet activates
  useEffect(() => {
    if (sheetState !== "collapsed") {
      setAcctOpen(false);
      acctOpenRef.current = false;
    }
  }, [sheetState]);

  function onAcctPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const startOff = acctOpenRef.current ? 0 : -(pageH() - ACCT_PEEK);
    acctDragStartY.current = e.clientY;
    acctDragStartTransY.current = startOff;
    acctLastY.current = e.clientY;
    acctLastT.current = e.timeStamp;
    acctVel.current = 0;
    setAcctDragging(true);
    setAcctTransY(startOff);
  }

  function onAcctPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const dt = e.timeStamp - acctLastT.current;
    if (dt > 0) acctVel.current = (e.clientY - acctLastY.current) / dt;
    acctLastY.current = e.clientY;
    acctLastT.current = e.timeStamp;
    const dy = e.clientY - acctDragStartY.current;
    const raw = acctDragStartTransY.current + dy;
    const max = pageH() - ACCT_PEEK;
    setAcctTransY(Math.max(-max, Math.min(0, raw)));
  }

  function onAcctPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const FLING = 0.22; // light flick triggers snap
    const vel = acctVel.current;
    const max = pageH() - ACCT_PEEK;
    // Pull-down drawer: downward drag (positive vel) opens, upward (negative vel) closes.
    // 10% of travel either direction commits the snap — very forgiving.
    const shouldOpen = vel > FLING ? true : vel < -FLING ? false : acctTransY >= -max * 0.90;
    acctSnapDir.current = shouldOpen ? "open" : "close";
    setAcctDragging(false);
    setAcctOpen(shouldOpen);
    acctOpenRef.current = shouldOpen;
  }

  const filtered = spots.filter(s => filter === "All" || s.meta.toLowerCase().includes(filter.toLowerCase()));

  // nearbyOrigin: "Search here" map center > searched pin > GPS > city default
  const nearbyOrigin = useMemo<[number, number]>(() =>
    mapSearchOrigin ?? (searchPin ? [searchPin.lat, searchPin.lng] : (userPos ?? CITY_CENTER)),
  [mapSearchOrigin, searchPin, userPos]);
  const nearbySpots = useMemo(() => {
    if (!nearbyMode) return [];
    const sorted = [...spots].sort(
      (a, b) => haversineKm(a.lat, a.lng, nearbyOrigin[0], nearbyOrigin[1]) - haversineKm(b.lat, b.lng, nearbyOrigin[0], nearbyOrigin[1])
    );
    const withinRadius = sorted.filter(s => haversineKm(s.lat, s.lng, nearbyOrigin[0], nearbyOrigin[1]) * 1000 <= nearbyRadius);
    // Always show at least 6 closest spots so the list is never empty
    return withinRadius.length >= 3 ? withinRadius : sorted.slice(0, 6);
  }, [nearbyMode, nearbyRadius, nearbyOrigin]);
  const nearbyIds = useMemo(() => new Set(nearbySpots.map(s => s.id)), [nearbySpots]);

  const viewportSpots = useMemo(() => {
    if (!mapBounds) return [];
    return spots.filter(s => {
      if (filter !== "All" && !s.meta.toLowerCase().includes(filter.toLowerCase())) return false;
      return mapBounds.contains([s.lat, s.lng]);
    }).sort((a, b) => {
      if (a.featured && !b.featured) return -1;
      if (!a.featured && b.featured) return 1;
      return parseInt(a.price) - parseInt(b.price);
    });
  }, [mapBounds, filter]);

  const searchNearbySpots = useMemo(() => {
    if (!searchPin) return [];
    return spots
      .map(s => ({ ...s, _dist: haversineKm(s.lat, s.lng, searchPin.lat, searchPin.lng) }))
      .filter(s => s._dist <= 4.828)
      .sort((a, b) => a._dist - b._dist)
      .slice(0, 20);
  }, [searchPin]);

  const searchNearbyCount = searchNearbySpots.length;

  const sheetHeightMap: Record<SheetState, string> = {
    collapsed: "17%",
    half: "50%",
    full: "88%",
  };
  const sheetHeight = sheetHeightMap[sheetState];

  useEffect(() => {
    if (selectedSpot !== null) setSheetState("full");
    else if (sheetStateRef.current === "full") setSheetState("half");
    if (selectedSpot !== null) {
      const now = new Date();
      const start = new Date(now);
      start.setHours(now.getHours() + 1, 0, 0, 0);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      setBookStartTs(start.getTime());
      setBookEndTs(end.getTime());
    } else {
      setBookStartTs(null);
      setBookEndTs(null);
    }
  }, [selectedSpot]);

  // Converts a search radius (metres) to an appropriate map zoom level
  function radiusToZoom(r: number): number {
    // 15 m → 18,  4828 m → 11  (log-linear interpolation)
    const t = (Math.log(Math.max(15, r)) - Math.log(15)) / (Math.log(4828) - Math.log(15));
    return Math.round(18 - t * 7);
  }

  // Helper: snap map to fit a set of lat/lng points above the bottom sheet
  const fitMapToPoints = useCallback((
    points: [number, number][],
    fallback: [number, number],
    timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
    delay = 160,
    targetZoom?: number,
  ) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const map = mapRef.current;
      if (!map) return;
      map.stop(); // cancel any in-flight animation first
      const zoom = targetZoom ?? 14;
      if (points.length === 0) {
        map.flyTo(fallback, zoom, { duration: 0.55 });
        return;
      }
      if (points.length === 1) {
        map.flyTo(points[0], zoom, { duration: 0.55 });
        return;
      }
      const bounds = L.latLngBounds(points);
      // Sheet in "half" state covers ~50% of screen height; leave room above it + generous padding
      const sheetPad = pageH() * 0.50;
      map.flyToBounds(bounds, {
        paddingTopLeft:     [60, 90],
        paddingBottomRight: [60, sheetPad],
        duration: 0.55,
      });
    }, delay);
  }, []);

  // (Removed) auto-fit on nearbyMode/spots change — the map should only move
  // when the user explicitly presses the locate-me button or selects a spot.

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 3) { setSuggestions([]); setSugOpen(false); return; }
    setFetching(true);
    try {
      const { place, cityHint } = parseQueryCity(q);

      // Resolve bias: explicit city mention in query takes priority over stored cityBias
      let biasLat = cityBias?.lat;
      let biasLng = cityBias?.lng;
      if (cityHint) {
        try {
          const cr = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityHint)}&format=json&limit=1`,
            { headers: { "Accept-Language": "en" } }
          );
          const cd: NominatimResult[] = await cr.json();
          if (cd.length > 0) { biasLat = parseFloat(cd[0].lat); biasLng = parseFloat(cd[0].lon); }
        } catch { /* keep existing bias */ }
      }

      // Both engines search globally. When the user explicitly types "in [city]" we geocode
      // that city and use it as a bias — otherwise zero bias so results are not locked to
      // the user's current location (Photon uses IP-based geolocation by default, so we
      // must pass location_bias_scale=0 to suppress it for unqualified queries).
      const searchTerm = cityHint ? place : q;
      const hasExplicitCity = cityHint && biasLat != null && biasLng != null;
      const photonParams = hasExplicitCity
        ? `&lat=${biasLat}&lon=${biasLng}&location_bias_scale=0.5`
        : `&location_bias_scale=0`;

      // Fire Nominatim + Photon in parallel
      const [nomRes, photonRes] = await Promise.allSettled([
        fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchTerm)}&format=json&limit=5&addressdetails=1`,
          { headers: { "Accept-Language": "en" } }
        ).then(r => r.json() as Promise<NominatimResult[]>),
        fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(searchTerm)}&limit=6${photonParams}`,
          { headers: { "Accept-Language": "en" } }
        ).then(r => r.json() as Promise<{ features: PhotonFeature[] }>),
      ]);

      const nomData: NominatimResult[] = nomRes.status === "fulfilled" ? nomRes.value : [];
      const photonFeatures: PhotonFeature[] = photonRes.status === "fulfilled"
        ? (photonRes.value.features ?? [])
        : [];
      const photonData: NominatimResult[] = photonFeatures.map(photonToNom);

      // Merge — Nominatim first (usually more precise), then Photon extras
      // Deduplicate by rounded coordinate pair
      const seen = new Set<string>();
      const merged: NominatimResult[] = [];
      for (const r of [...nomData, ...photonData]) {
        if (!r.lat || !r.lon || !r.display_name) continue;
        const key = `${parseFloat(r.lat).toFixed(2)},${parseFloat(r.lon).toFixed(2)}`;
        if (!seen.has(key)) { seen.add(key); merged.push(r); }
      }

      setSuggestions(merged.slice(0, 6));
      setSugOpen(merged.length > 0);
    } catch {
      setSuggestions([]);
      setSugOpen(false);
    } finally {
      setFetching(false);
    }
  }, [cityBias]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(q), 320);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery, fetchSuggestions]);

  // On mount: silently get location if already granted — skip prompt, set cityBias + cityName
  useEffect(() => {
    if (!navigator.geolocation) return;
    const tryGet = () => navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords;
        const coords: [number, number] = [latitude, longitude];
        setGlobeMode(false);  // skip globe entirely — go straight to map in their area
        setUserPos(coords);
        setCityBias({ lat: latitude, lng: longitude });
        setMapCenter(coords);
        setMapZoom(NEIGHBORHOOD_ZOOM);
        fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&addressdetails=1`,
          { headers: { "Accept-Language": "en" } }
        )
          .then(r => r.json())
          .then((d: NominatimResult) => { const n = extractCityName(d.address); if (n) setCityName(n); })
          .catch(() => {});
      },
      () => {},
      { timeout: 4000, maximumAge: 120000 }
    );
    let haveSavedLoc = !!_savedLoc?.userPos;
    if (!haveSavedLoc) {
      try {
        const raw = localStorage.getItem(LOC_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as SavedLocation;
          if (parsed?.userPos) haveSavedLoc = true;
        }
      } catch {}
    }
    if (navigator.permissions) {
      navigator.permissions.query({ name: "geolocation" }).then(res => {
        if (res.state === "granted") {
          tryGet();
        } else if (res.state === "prompt" && !haveSavedLoc) {
          setLocPromptOpen(true);
        }
      }).catch(() => {
        if (!haveSavedLoc) setLocPromptOpen(true);
      });
    } else if (!haveSavedLoc) {
      setLocPromptOpen(true);
    }
  }, []);

  const grantLocation = () => {
    if (!navigator.geolocation) { setLocPromptOpen(false); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords;
        const coords: [number, number] = [latitude, longitude];
        setGlobeMode(false);
        setUserPos(coords);
        setCityBias({ lat: latitude, lng: longitude });
        setMapCenter(coords);
        setMapZoom(NEIGHBORHOOD_ZOOM);
        mapRef.current?.flyTo(coords, 15, { duration: 1.1 });
        setLocating(false);
        setLocPromptOpen(false);
        localStorage.removeItem("lilypad_loc_skipped");
        fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&addressdetails=1`,
          { headers: { "Accept-Language": "en" } }
        )
          .then(r => r.json())
          .then((d: NominatimResult) => { const n = extractCityName(d.address); if (n) setCityName(n); })
          .catch(() => {});
      },
      () => { setLocating(false); setLocDenied(true); setLocPromptOpen(false); },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  };
  const skipLocation = () => {
    setLocPromptOpen(false);
  };

  // Keep cityBias in sync whenever userPos changes from any source
  useEffect(() => {
    if (userPos) setCityBias({ lat: userPos[0], lng: userPos[1] });
  }, [userPos]);

  // Persist location to localStorage so it survives navigation + browser restarts
  useEffect(() => {
    if (globeMode) return; // only save once the user has a real location
    try {
      localStorage.setItem(LOC_KEY, JSON.stringify({
        mapCenter,
        mapZoom,
        userPos,
        cityBias,
        cityName,
      } satisfies SavedLocation));
    } catch { /* ignore quota/security errors */ }
  }, [globeMode, mapCenter, mapZoom, userPos, cityBias, cityName]);

  function pickSuggestion(r: NominatimResult) {
    setSugOpen(false);
    setSuggestions([]);
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lon);
    setCityBias({ lat, lng });
    setMapCenter([lat, lng]);
    setMapZoom(NEIGHBORHOOD_ZOOM);
    const rawName = r.display_name.split(",")[0].trim();
    const pinDomain = getBrandDomain(rawName, {}) ?? (rawName.toLowerCase().replace(/[^a-z0-9]/g, "") + ".com");
    setSearchPin({ lat, lng, type: r.type, osmClass: r.class, name: rawName, domain: pinDomain });
    setMapSearchOrigin(null);
    const name = extractCityName(r.address) || rawName;
    setCityName(name);
    setSearchQuery("");
    setSearchFocused(false);
    // Always show spots near this location when user picks a result
    setNearbyMode(true);
    // If globe is showing, zoom it in then switch to Leaflet
    if (globeModeRef.current) {
      setGlobeZoomTarget([lat, lng]);
    } else {
      // Already on the map — fly to the point, offset so it appears in the
      // visible area above the half-height sheet instead of behind it
      const map = mapRef.current;
      if (map) {
        const sheetPad = pageH() * 0.52;
        setTimeout(() => {
          map.flyToBounds(L.latLngBounds([[lat, lng], [lat, lng]]).pad(0.003), {
            paddingTopLeft:     [40, 80],
            paddingBottomRight: [40, sheetPad],
            maxZoom: NEIGHBORHOOD_ZOOM,
            duration: 0.8,
          });
        }, 80);
      }
    }
  }

  function collapseSearch() {
    setSearchFocused(false);
    setSugOpen(false);
    setSuggestions([]);
    setSearchQuery("");
  }

  const handleBizClick = useCallback((name: string, domain: string, lat: number, lng: number) => {
    // Set the tapped business as the origin pin
    setSearchPin({ lat, lng, type: "business", osmClass: "business", name, domain });
    // Activate nearby mode so spots appear immediately around this location
    setNearbyMode(true);
    // Clear any competing modes
    setSelectedSpot(null);
    // Open the sheet (half shows the spot list + slider, collapsed hides it)
    if (sheetStateRef.current === "collapsed") setSheetState("half");
  }, []);

  function activateNearMe(coords: [number, number]) {
    setSearchPin({ lat: coords[0], lng: coords[1], type: "nearme", osmClass: "nearme", name: "Near Me", domain: "__nearme__" });
    setMapCenter(coords);
    setMapZoom(NEIGHBORHOOD_ZOOM);
    setMapSearchOrigin(null);
    mapRef.current?.flyTo(coords, NEIGHBORHOOD_ZOOM, { duration: 1.1 });
  }


  async function recenter() {
    // If we already have the position, just fly back — no prompt needed
    if (userPos) {
      mapRef.current?.flyTo(userPos, 15, { duration: 1.1 });
      return;
    }

    if (!navigator.geolocation) {
      setLocDenied(true);
      return;
    }

    // Check permission state first (avoids a silent fail when already denied)
    if (navigator.permissions) {
      try {
        const perm = await navigator.permissions.query({ name: "geolocation" });
        if (perm.state === "denied") {
          setLocDenied(true);
          return;
        }
      } catch { /* permissions API not supported — fall through */ }
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        const latlng: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setUserPos(latlng);
        setLocating(false);
        mapRef.current?.flyTo(latlng, 15, { duration: 1.1 });
      },
      err => {
        setLocating(false);
        if (err.code === 1 /* PERMISSION_DENIED */) setLocDenied(true);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function findMe() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        const latlng: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setUserPos(latlng);
        setLocating(false);
        setMapCenter(latlng);
        setMapZoom(NEIGHBORHOOD_ZOOM);
      },
      () => { setLocating(false); },
      { timeout: 8000 }
    );
  }

  function selectSpot(id: string) {
    setSelectedSpot(prev => prev === id ? null : id);
  }

  function formatRadius(meters: number): string {
    const feet = Math.round(meters * 3.28084);
    if (feet < 1000) return `${feet} ft`;
    return `${(meters / 1609.34).toFixed(1)} mi`;
  }

  // ── Sheet drag helpers ──────────────────────────────────────────────────────
  const SNAP_RATIOS: Record<SheetState, number> = { collapsed: 0.17, half: 0.50, full: 0.88 };
  const SNAP_ORDER: SheetState[] = ["collapsed", "half", "full"];

  function snapHeightPx(state: SheetState) {
    return Math.round(pageH() * SNAP_RATIOS[state]);
  }

  // draggedOffset = dragOffsetRef.current at the moment of release.
  // Positive = user made the sheet taller (dragged up). Negative = shorter (dragged down).
  function resolveSnap(heightPx: number, vel: number, draggedOffset: number): SheetState {
    const FLING      = 0.22;  // light flick threshold
    const HARD_FLING = 0.60;  // forceful throw — jumps straight to full or collapsed
    // Hard throws skip all intermediate markers
    if (vel < -HARD_FLING) return "full";
    if (vel >  HARD_FLING) return "collapsed";
    // Any upward fling → go all the way to full, regardless of how far the finger traveled.
    // This covers a swift push from collapsed AND the common deceleration case.
    if (vel < -FLING) return "full";
    // Find the nearest snap point by the actual drag position.
    let nearest: SheetState = "collapsed";
    let nearestDist = Infinity;
    for (const s of SNAP_ORDER) {
      const d = Math.abs(heightPx - snapHeightPx(s));
      if (d < nearestDist) { nearestDist = d; nearest = s; }
    }
    const idx = SNAP_ORDER.indexOf(nearest);
    // Downward fling nudge: ONLY apply when the user actually dragged the sheet
    // shorter (draggedOffset < 0). If the user dragged UP (draggedOffset > 0) but the
    // last velocity sample has a tiny positive tick from finger deceleration, we
    // must NOT nudge down — that's what caused "locks at the half point" when
    // dragging from half toward full.
    if (vel > FLING && draggedOffset < 0) {
      return SNAP_ORDER[Math.max(idx - 1, 0)];
    }
    return nearest;
  }

  function onHandlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation(); // prevent sheet outer div from starting a pending drag
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartY.current = e.clientY;
    dragStartH.current = snapHeightPx(sheetStateRef.current);
    lastDragY.current = e.clientY;
    lastDragT.current = e.timeStamp;
    dragVelocity.current = 0;
    dragOffsetRef.current = 0;
    isDraggingRef.current = true;
    setDragging(true);
    setDragOffset(0);
  }

  function onHandlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const dt = e.timeStamp - lastDragT.current;
    if (dt > 0) dragVelocity.current = (e.clientY - lastDragY.current) / dt;
    lastDragY.current = e.clientY;
    lastDragT.current = e.timeStamp;
    const dy = dragStartY.current - e.clientY; // positive = dragged up
    const raw = dragStartH.current + dy;
    const minH = snapHeightPx("collapsed");
    const maxH = snapHeightPx("full");
    // Follow the finger exactly — no magnetic pull during drag.
    // Snap only fires on pointer-up (resolveSnap). This keeps motion fluid
    // through every marker with zero resistance, just like the account drawer.
    const clamped = Math.max(minH * 0.85, Math.min(maxH * 1.02, raw));
    const off = clamped - dragStartH.current;
    dragOffsetRef.current = off;
    setDragOffset(off);
  }

  function onHandlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    isDraggingRef.current = false;
    // A "tap" is a release with essentially no motion AND no flick velocity.
    // A small downward swipe (even <6px) with a clear down-velocity should NOT
    // be treated as a tap — it should snap the sheet down one step.
    const movedFar = Math.abs(dragOffsetRef.current) >= 6;
    const flicked = Math.abs(dragVelocity.current) > 0.18;
    const isTap = !movedFar && !flicked;
    const currentH = dragStartH.current + dragOffsetRef.current;
    const cur = SNAP_ORDER.indexOf(sheetStateRef.current);
    let target: SheetState;
    if (isTap) {
      target = SNAP_ORDER[Math.min(cur + 1, SNAP_ORDER.length - 1)];
    } else if (!movedFar && flicked) {
      // Light swipe with no real travel — step in the swipe direction.
      const step = dragVelocity.current > 0 ? -1 : 1;
      target = SNAP_ORDER[Math.max(0, Math.min(SNAP_ORDER.length - 1, cur + step))];
    } else {
      target = resolveSnap(currentH, dragVelocity.current, dragOffsetRef.current);
    }
    setDragging(false);
    setDragOffset(0);
    // Auto-activate content mode when user pulls sheet up from collapsed with no active state
    if (sheetStateRef.current === "collapsed" && (target === "half" || target === "full")) {
      if (!nearbyMode && selectedSpot === null) {
        setNearbyMode(true);
        setSheetState(target);
        return;
      }
    }
    // Dragged down to collapsed → dismiss active state
    if (target === "collapsed") {
      setSelectedSpot(null);
      setNearbyMode(false);
    }
    setSheetState(target);
  }

  // ── Sheet-wide drag handlers (downward swipe from anywhere on the sheet) ──
  function onSheetPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (isDraggingRef.current) return; // handle already owns this drag
    // When collapsed: capture the pointer immediately so the browser can't
    // steal it for scroll. The direction is resolved in onSheetPointerMove.
    if (sheetStateRef.current === "collapsed") {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    pendingSheetDragY.current = e.clientY;
    pendingSheetDragH.current = snapHeightPx(sheetStateRef.current);
    pendingSheetDragT.current = e.timeStamp; // record touch start for velocity
  }

  function onSheetPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    // ── Case A: sheet owns this pointer — run active drag ──
    if (e.currentTarget.hasPointerCapture(e.pointerId) && isDraggingRef.current) {
      const dt = e.timeStamp - lastDragT.current;
      if (dt > 0) dragVelocity.current = (e.clientY - lastDragY.current) / dt;
      lastDragY.current = e.clientY;
      lastDragT.current = e.timeStamp;
      const dy = dragStartY.current - e.clientY;
      const raw = dragStartH.current + dy;
      const minH = snapHeightPx("collapsed");
      const maxH = snapHeightPx("full");
      const clamped = Math.max(minH * 0.85, Math.min(maxH * 1.02, raw));
      const off = clamped - dragStartH.current;
      dragOffsetRef.current = off;
      setDragOffset(off);
      return;
    }
    // ── Case B: pending — commit on any clear motion ──
    if (pendingSheetDragY.current < 0) return;
    const downDy = e.clientY - pendingSheetDragY.current; // positive = down, negative = up
    const dt = e.timeStamp - pendingSheetDragT.current;
    const flingVel = dt > 0 ? downDy / dt : 0; // px/ms — positive=down, negative=up

    if (downDy < -3) {
      // Upward movement — if sheet is collapsed, this is an open gesture.
      // Capture immediately so the whole sheet body acts as a grab target.
      if (sheetStateRef.current === "collapsed") {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragStartY.current = pendingSheetDragY.current;
        dragStartH.current = pendingSheetDragH.current;
        lastDragY.current = e.clientY;
        lastDragT.current = e.timeStamp;
        dragVelocity.current = flingVel; // negative = moving up = opening
        dragOffsetRef.current = 0;
        pendingSheetDragY.current = -1;
        isDraggingRef.current = true;
        setDragging(true);
        setDragOffset(0);
      } else {
        // Sheet is open — upward swipe is for scrolling content, not dragging
        pendingSheetDragY.current = -1;
      }
      return;
    }

    if (downDy > 3) {
      const scrollTop = cardsRef.current?.scrollTop ?? 0;
      // Capture when: content is at top (no scroll conflict)
      //            OR user is clearly throwing it down with force
      const shouldCapture = scrollTop <= 2 || flingVel > 0.45;
      if (shouldCapture) {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragStartY.current = pendingSheetDragY.current;
        dragStartH.current = pendingSheetDragH.current;
        lastDragY.current = e.clientY;
        lastDragT.current = e.timeStamp;
        dragVelocity.current = flingVel;
        dragOffsetRef.current = 0;
        pendingSheetDragY.current = -1;
        isDraggingRef.current = true;
        setDragging(true);
        setDragOffset(0);
      } else {
        pendingSheetDragY.current = -1; // scrolled content, gentle swipe — let it scroll
      }
    }
  }

  function onSheetPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pendingSheetDragY.current = -1;
    if (!e.currentTarget.hasPointerCapture(e.pointerId) || !isDraggingRef.current) return;
    isDraggingRef.current = false;
    // Same flick/tap thresholds as the drag handle so a quick light swipe
    // (small travel + clear velocity) doesn't get misclassified as a tap.
    const movedFar = Math.abs(dragOffsetRef.current) >= 6;
    const flicked = Math.abs(dragVelocity.current) > 0.18;
    const isTap = !movedFar && !flicked;
    const currentH = dragStartH.current + dragOffsetRef.current;
    const cur = SNAP_ORDER.indexOf(sheetStateRef.current);
    let target: SheetState;
    if (isTap) {
      target = SNAP_ORDER[Math.min(cur + 1, SNAP_ORDER.length - 1)];
    } else if (!movedFar && flicked) {
      const step = dragVelocity.current > 0 ? -1 : 1;
      target = SNAP_ORDER[Math.max(0, Math.min(SNAP_ORDER.length - 1, cur + step))];
    } else {
      target = resolveSnap(currentH, dragVelocity.current, dragOffsetRef.current);
    }
    setDragging(false);
    setDragOffset(0);
    if (sheetStateRef.current === "collapsed" && (target === "half" || target === "full")) {
      if (!nearbyMode && selectedSpot === null) {
        setNearbyMode(true);
        setSheetState(target);
        return;
      }
    }
    if (target === "collapsed") {
      setSelectedSpot(null);
      setNearbyMode(false);
    }
    setSheetState(target);
  }

  // Always work in px so CSS can tween px→px and fullness stays accurate when settled
  const liveSheetHNum = dragging
    ? Math.max(snapHeightPx("collapsed") * 0.85, Math.min(snapHeightPx("full") * 1.02,
        dragStartH.current + dragOffset))
    : snapHeightPx(sheetState);
  const liveSheetH = `${Math.round(liveSheetHNum)}px`;

  // Interpolate sheet glass density as it approaches full-height
  const _snapCollapsed = snapHeightPx("collapsed");
  const _snapFull      = snapHeightPx("full");
  const sheetFullness  = Math.max(0, Math.min(1, (liveSheetHNum - _snapCollapsed) / (_snapFull - _snapCollapsed)));
  const sheetBgAlpha   = 0.14 + sheetFullness * 0.66;  // 0.14 (barely there) → 0.80 (rich dark)
  const sheetBlurPx    = Math.round(6 + sheetFullness * 20); // 6px → 26px

  // Account drawer — live translateY and glass density
  const _acctMax       = pageH() - ACCT_PEEK;
  const acctLiveTransY = acctDragging
    ? Math.max(-_acctMax, Math.min(0, acctTransY))
    : (acctOpen ? 0 : -_acctMax);
  const acctFullness   = Math.max(0, Math.min(1, (acctLiveTransY + _acctMax) / _acctMax));
  const acctBgAlpha    = 0.07 + acctFullness * 0.93;
  const acctBlurPx     = Math.round(22 + acctFullness * 4);
  // Pointer-events guard: the account swipe-down should be grabbable whenever
  // its handle is visible at the top of the screen. The handle only slides up
  // out of frame after the bottom sheet passes the "half" snap on its way to
  // "full", so allow interaction while the sheet is collapsed OR at half.
  const acctVisible    = sheetState !== "full";
  // Push account handle off-screen as sheet rises, and push sheet off-screen as account opens.
  // Keep the handle in its low/grabbable resting position while the bottom sheet is at or
  // below the "half" snap point — only start sliding the handle up once the sheet passes
  // the middle on its way to "full". This prevents the swipe-down bar from being clipped
  // off the top of the phone frame at the half state on taller devices (e.g. iPhone 17 Plus).
  const _snapHalf               = snapHeightPx("half");
  const acctHandlePushFraction  = _snapFull > _snapHalf
    ? Math.max(0, Math.min(1, (liveSheetHNum - _snapHalf) / (_snapFull - _snapHalf)))
    : 0;
  const effectiveAcctTransY = Math.round(acctLiveTransY - acctHandlePushFraction * ACCT_PEEK);
  const sheetPushDownPx     = Math.round(acctFullness * _snapCollapsed);

  return (
    <div ref={pageRef} className="page active" style={{ position: "relative", fontFamily: "'DM Sans', sans-serif" }}>

      {/* ── COMING SOON SCREEN (non-admin/staff users) ── */}
      {comingSoon && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 10,
          background: "#0E1F40",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          padding: "0 32px",
          fontFamily: "'DM Sans', sans-serif",
        }}>
          <div style={{
            width: 72, height: 72, borderRadius: "50%",
            background: "rgba(141,214,63,0.14)",
            border: "1.5px solid rgba(141,214,63,0.30)",
            display: "flex", alignItems: "center", justifyContent: "center",
            marginBottom: 22,
          }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#8DD63F" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="10" r="6" />
              <path d="M12 16v5M8 21h8" />
            </svg>
          </div>
          <div style={{
            background: "rgba(141,214,63,0.12)",
            border: "1px solid rgba(141,214,63,0.28)",
            borderRadius: 100, padding: "5px 14px",
            fontSize: 10, fontWeight: 800, letterSpacing: "0.14em",
            color: "#8DD63F", textTransform: "uppercase", marginBottom: 16,
          }}>Coming Soon</div>
          <p style={{
            fontSize: 26, fontWeight: 800, color: "#fff",
            margin: "0 0 12px", letterSpacing: "-0.02em", textAlign: "center",
          }}>Parking is on its way.</p>
          <p style={{
            fontSize: 14, color: "rgba(255,255,255,0.50)",
            margin: 0, lineHeight: 1.6, textAlign: "center", maxWidth: 280,
          }}>
            Real Houston driveways are being added. Use your account below to manage your listing or settings.
          </p>
        </div>
      )}

      {/* ── 3D GLOBE (no location / no city yet) ── */}
      {globeMode && !comingSoon && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 5,
          opacity: globeFading ? 0 : 1,
          transition: "opacity 0.7s ease",
          pointerEvents: globeFading ? "none" : "auto",
        }}>
          <GlobeView
            spots={spots}
            zoomTarget={globeZoomTarget}
            onZoomedIn={() => {
              // Mount map, start globe fade, then on next frames fade map in
              setMapMounted(true);
              setGlobeFading(true);
              requestAnimationFrame(() => requestAnimationFrame(() => setMapOpacity(1)));
              setTimeout(() => {
                setGlobeMode(false);
                setGlobeFading(false);
                setMapMounted(false);
                setMapOpacity(0);
              }, 750);
            }}
            onFallback={() => setGlobeMode(false)}
            onSpotPicked={(lat, lng) => {
              setMapCenter([lat, lng]);
              setMapZoom(NEIGHBORHOOD_ZOOM);
              setGlobeZoomTarget([lat, lng]);
            }}
          />
        </div>
      )}

      {/* ── FULL-SCREEN MAP ── */}
      {!comingSoon && (!globeMode || mapMounted) && <div style={{
          position: "absolute", inset: 0, zIndex: 1,
          opacity: mapMounted ? mapOpacity : 1,
          transition: "opacity 0.7s ease",
        }} onClick={() => setSugOpen(false)}>
        <MapContainer
          center={mapCenter}
          zoom={mapZoom}
          zoomControl={false}
          style={{ width: "100%", height: "100%" }}
          attributionControl={false}
        >
          <TileLayer key={activeTile} url={activeTile} />
          <NeighborhoodLabels />
          <MapRefSetter mapRef={mapRef} />
          <MapController center={mapCenter} zoom={mapZoom} />
          <MapClickHandler onMapClick={() => { setSelectedSpot(null); }} />
          <MapBoundsTracker onBoundsChange={setMapBounds} />
          {userPos && <Marker position={userPos} icon={userDotIcon} />}
          {searchPin && searchPin.osmClass !== "business" && (
            <Marker
              position={[searchPin.lat, searchPin.lng]}
              icon={createSearchPinIcon(searchPin.type, searchPin.osmClass)}
              eventHandlers={{ click: () => setSugOpen(false) }}
            />
          )}
          {filtered.map(spot => {
            const isSelected = selectedSpot === spot.id;
            const isNearbyHighlighted = !isSelected && (mapBounds?.contains([spot.lat, spot.lng]) ?? false);
            return (
              <Marker
                key={`${spot.id}-${isSelected}-${isNearbyHighlighted}`}
                position={[spot.lat, spot.lng]}
                icon={createPinIcon(spot.price, spot.featured, isSelected, isNearbyHighlighted, getSpotStatus(spot.id))}
                eventHandlers={{
                  click: (e) => {
                    e.originalEvent.stopPropagation();
                    selectSpot(spot.id);
                  }
                }}
              />
            );
          })}
          <MapBusinessLogos onBizClick={handleBizClick} enabled={showHotspots} />
        </MapContainer>


      </div>}

      {/* ── Admin / Staff view banner ── */}
      {state.adminPreview && !globeMode && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, zIndex: 600,
          background: "#0E1F40", color: "#fff",
          padding: "8px 14px",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          fontFamily: "'DM Sans', sans-serif",
          boxShadow: "0 2px 12px rgba(0,0,0,0.25)",
        }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#8DD63F", flexShrink: 0 }} />
          <p style={{ margin: 0, fontSize: 11.5, fontWeight: 800, letterSpacing: "0.14em", color: "#8DD63F", textTransform: "uppercase" }}>
            {state.adminPreviewRole === "staff" ? "Staff view" : "Admin view"}
          </p>
        </div>
      )}

      {/* ── TEMP HOME BUTTON — floats above sheet on the left, mirrors recenter on the right ── */}
      {!globeMode && (
        <button
          onClick={() => {
            if (state.adminPreview || sessionStorage.getItem("lp_admin_preview") === "1") {
              sessionStorage.removeItem("lp_admin_preview");
              setAppState(s => ({ ...s, adminPreview: false, adminPreviewRole: null }));
              goTo("admin");
            } else {
              authSignOut().then(() => goTo("home"));
            }
          }}
          title={state.adminPreview ? "Back to admin" : "Back to home"}
          style={{
            position: "absolute",
            left: 16,
            bottom: `calc(${liveSheetH} + 12px)`,
            zIndex: 26,
            width: 44, height: 44, borderRadius: "50%",
            background: "rgba(255,255,255,0.92)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(14,31,64,0.10)",
            boxShadow: "0 2px 12px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.7)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer",
            transition: dragging ? "none" : "bottom 0.42s cubic-bezier(0.22,1,0.36,1)",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0E1F40" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </button>
      )}

      {/* ── UNIFIED SEARCH PILL — centered on globe, top-anchored on map ── */}
      {!comingSoon && (globeMode || sheetState !== "full") && <div style={{
        position: "absolute",
        ...(globeMode
          ? { top: "50%", left: 24, right: 24, transform: "translateY(-50%)" }
          : { top: "max(102px, calc(env(safe-area-inset-top) + 100px))", left: 16, right: 16 }),
        zIndex: 30,
        pointerEvents: "none",
        opacity: globeFading ? 0 : 1,
        transition: "opacity 0.35s ease",
      }}>
        <div style={{ position: "relative" }}>

          {/* ── IDLE: single pill ── */}
          {!searchFocused && (
            <div
              onClick={() => { setSearchFocused(true); setTimeout(() => cityInputRef.current?.focus(), 60); }}
              style={{
                pointerEvents: "auto",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: globeMode ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.96)",
                backdropFilter: globeMode ? "blur(28px)" : "none",
                WebkitBackdropFilter: globeMode ? "blur(28px)" : "none",
                border: globeMode ? "1px solid rgba(255,255,255,0.38)" : "1px solid rgba(14,31,64,0.1)",
                borderRadius: 14,
                boxShadow: globeMode
                  ? "0 8px 40px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.22), 0 0 0 1.5px rgba(56,120,240,0.22), 0 0 32px rgba(56,120,240,0.14)"
                  : "0 2px 16px rgba(0,0,0,0.14), 0 0 0 1px rgba(14,31,64,0.05)",
                height: globeMode ? 52 : 46,
                padding: "0 18px",
                gap: 10,
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <svg width={globeMode ? 16 : 15} height={globeMode ? 16 : 15} viewBox="0 0 24 24" fill="none"
                stroke={globeMode ? "rgba(255,255,255,0.85)" : "rgba(14,31,64,0.45)"}
                strokeWidth="2.2" strokeLinecap="round" style={{ flexShrink: 0 }}>
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <span style={{
                fontSize: globeMode ? 16 : 15,
                fontStyle: "italic",
                color: globeMode ? "#fff" : "rgba(14,31,64,0.55)",
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: globeMode ? 500 : 400,
                letterSpacing: -0.2,
              }}>
                Where do you want to park?
              </span>
            </div>
          )}

          {/* ── EXPANDED: single unified search input ── */}
          {searchFocused && (() => {
            const isGlobe = globeMode;
            const inputCol = isGlobe ? "rgba(255,255,255,0.95)" : "#0E1F40";
            return (
            <div style={{
              pointerEvents: "auto",
              display: "flex", alignItems: "center",
              background: isGlobe ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.96)",
              backdropFilter: isGlobe ? "blur(28px)" : "none",
              WebkitBackdropFilter: isGlobe ? "blur(28px)" : "none",
              border: isGlobe ? "1px solid rgba(255,255,255,0.28)" : "1px solid rgba(14,31,64,0.1)",
              borderRadius: sugOpen && suggestions.length > 0 ? "14px 14px 0 0" : 14,
              boxShadow: isGlobe
                ? "0 4px 24px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.18), 0 0 0 1.5px rgba(56,120,240,0.18), 0 0 22px rgba(56,120,240,0.1)"
                : "0 2px 16px rgba(0,0,0,0.12), 0 0 0 1px rgba(14,31,64,0.05)",
              height: 46,
              padding: "0 10px",
              gap: 6,
            }}>
              {fetching
                ? <div style={{ width: 14, height: 14, flexShrink: 0, borderRadius: "50%", border: `2px solid ${isGlobe ? "rgba(255,255,255,0.15)" : "rgba(14,31,64,0.1)"}`, borderTopColor: isGlobe ? "rgba(255,255,255,0.75)" : "#0E1F40", animation: "spin 0.7s linear infinite" }} />
                : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isGlobe ? "rgba(255,255,255,0.55)" : "rgba(14,31,64,0.35)"} strokeWidth="2.2" strokeLinecap="round" style={{ flexShrink: 0 }}>
                    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                  </svg>
              }
              <input
                ref={cityInputRef}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Escape") collapseSearch();
                  if (e.key === "Enter" && suggestions.length > 0) pickSuggestion(suggestions[0]);
                }}
                placeholder="Address, city, or ZIP"
                autoFocus
                className={`find-overlay-input${!isGlobe ? " find-overlay-input--dark" : ""}`}
                style={{
                  flex: 1, minWidth: 0,
                  background: "transparent", border: "none", outline: "none",
                  color: inputCol, fontSize: 14,
                  fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
                  letterSpacing: -0.1, padding: "0 2px",
                }}
              />
              {searchQuery.length > 0 && (
                <button
                  onClick={() => { setSearchQuery(""); setSuggestions([]); setSugOpen(false); cityInputRef.current?.focus(); }}
                  style={{
                    background: isGlobe ? "rgba(255,255,255,0.12)" : "rgba(14,31,64,0.07)", border: "none", borderRadius: "50%",
                    width: 20, height: 20, padding: 0, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                  }}
                >
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={isGlobe ? "rgba(255,255,255,0.75)" : "rgba(14,31,64,0.6)"} strokeWidth="2.8" strokeLinecap="round">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              )}
              <button
                onClick={collapseSearch}
                style={{
                  background: "none", border: "none", padding: "0 2px", flexShrink: 0,
                  cursor: "pointer", color: isGlobe ? "rgba(255,255,255,0.65)" : "rgba(14,31,64,0.5)",
                  fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
                }}
              >
                Cancel
              </button>
            </div>
            );
          })()}

          {/* ── Suggestions dropdown ── */}
          {searchFocused && sugOpen && suggestions.length > 0 && (
            <div style={{
              pointerEvents: "auto",
              background: "rgba(10,16,36,0.94)",
              backdropFilter: "blur(28px)",
              WebkitBackdropFilter: "blur(28px)",
              border: "1px solid rgba(255,255,255,0.11)",
              borderTop: "1px solid rgba(255,255,255,0.06)",
              borderRadius: "0 0 14px 14px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
              overflow: "hidden",
            }}>
              {suggestions.map((r, i) => (
                <button
                  key={r.place_id}
                  onClick={() => pickSuggestion(r)}
                  style={{
                    width: "100%", background: "transparent", border: "none",
                    borderTop: i > 0 ? "1px solid rgba(255,255,255,0.05)" : "none",
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "11px 14px", cursor: "pointer", textAlign: "left",
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                  </svg>
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,0.82)", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.3, fontWeight: 500 }}>
                    {shortLabel(r)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>}


      {/* ── LOCATION BUTTON — floating above the sheet ── */}
      {!comingSoon && !globeMode && (
        <div style={{ position: "absolute", right: 16, bottom: `calc(${liveSheetH} + 12px)`, zIndex: 25, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, transition: dragging ? "none" : "bottom 0.42s cubic-bezier(0.22,1,0.36,1)" }}>
          {/* Denied toast */}
          {locDenied && (
            <div
              onClick={() => setLocDenied(false)}
              style={{
                background: "rgba(10,10,14,0.88)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
                border: "1px solid rgba(239,68,68,0.55)",
                borderRadius: 12, padding: "8px 12px",
                fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.90)",
                maxWidth: 220, lineHeight: 1.4,
                boxShadow: "0 4px 20px rgba(239,68,68,0.22)",
                cursor: "pointer",
              }}>
              <span style={{ color: "#F87171" }}>📍 </span>
              Location access is blocked. Enable it in your browser settings to find parking near you.
            </div>
          )}
          <button
            onClick={recenter}
            title={userPos ? "Back to my location" : "Share location to find nearby parking"}
            style={{
              width: 44, height: 44,
              borderRadius: "50%",
              background: locating
                ? "rgba(56,189,248,0.22)"
                : userPos
                  ? "rgba(14,31,64,0.88)"
                  : "rgba(255,255,255,0.92)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              border: locating
                ? "1.5px solid rgba(56,189,248,0.5)"
                : userPos
                  ? "1.5px solid rgba(255,255,255,0.22)"
                  : "1px solid rgba(14,31,64,0.10)",
              boxShadow: userPos
                ? "0 2px 12px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.08)"
                : "0 2px 12px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.7)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            {locating ? (
              <div style={{ width: 18, height: 18, borderRadius: "50%", border: "2.5px solid rgba(56,189,248,0.25)", borderTopColor: "rgba(56,189,248,0.9)", animation: "spin 0.7s linear infinite" }} />
            ) : userPos ? (
              /* "Go back to my location" arrow icon */
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="3 11 22 2 13 21 11 13 3 11"/>
              </svg>
            ) : (
              /* "Share location" crosshair icon */
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0E1F40" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
                <circle cx="12" cy="12" r="8" strokeOpacity="0.25"/>
              </svg>
            )}
          </button>
        </div>
      )}

      {/* ── FROSTED BOTTOM SHEET ── */}
      {!comingSoon && <div
        onWheel={e => e.stopPropagation()}
        onTouchStart={e => { if (!dragging) e.stopPropagation(); }}
        onTouchMove={e => { if (!dragging) e.stopPropagation(); }}
        onTouchEnd={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onPointerDown={onSheetPointerDown}
        onPointerMove={onSheetPointerMove}
        onPointerUp={onSheetPointerUp}
        onPointerCancel={onSheetPointerUp}
        style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          height: liveSheetH,
          background: "#0E1F40",
          backdropFilter: "none",
          WebkitBackdropFilter: "none",
          borderRadius: "28px 28px 0 0",
          boxShadow: "0 -4px 24px rgba(0,0,0,0.30)",
          border: "none",
          zIndex: 20,
          transform: globeMode ? "translateY(110%)" : `translateY(${sheetPushDownPx}px)`,
          transition: dragging || acctDragging
            ? "none"
            : "height 0.42s cubic-bezier(0.22,1,0.36,1), transform 0.42s cubic-bezier(0.22,1,0.36,1)",
          display: "flex", flexDirection: "column", overflow: "hidden",
          willChange: "height, transform",
          touchAction: (sheetState === "collapsed" || dragging) ? "none" : "auto",
        }}>

        {/* Top row: handle pill + optional action buttons ── */}
        <div
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
          onTouchStart={e => e.stopPropagation()}
          style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start",
            // Bigger top padding when the sheet is at "full" so the grab pill
            // sits well clear of the device top edge / status bar.
            padding: sheetState === "full"
              ? `calc(env(safe-area-inset-top, 0px) + 18px) 16px 12px`
              : "10px 16px 8px",
            flexShrink: 0, position: "relative",
            minHeight: sheetState === "full" ? 64 : 48,
            touchAction: "none", cursor: dragging ? "grabbing" : "grab",
            userSelect: "none",
            transition: "min-height 0.32s cubic-bezier(0.22,1,0.36,1), padding 0.32s cubic-bezier(0.22,1,0.36,1)",
          }}>
          <div style={{
            width: dragging ? 52 : 40, height: 5,
            background: dragging ? "rgba(255,255,255,0.70)" : "rgba(255,255,255,0.35)",
            borderRadius: 100,
            transition: "width 0.2s, background 0.2s",
          }} />
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation();
              setSelectedSpot(null);
              setNearbyMode(false);
              setNearbyArcPaths([]);
              setSheetState("collapsed");
            }}
            style={{
              position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)",
              background: sheetState === "collapsed" ? "transparent" : "rgba(255,255,255,0.10)",
              border: sheetState === "collapsed" ? "none" : "1px solid rgba(255,255,255,0.18)",
              borderRadius: "50%", width: 30, height: 30,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: sheetState === "collapsed" ? "default" : "pointer",
              color: "rgba(255,255,255,0.75)",
              opacity: sheetState === "collapsed" ? 0 : 1,
              pointerEvents: sheetState === "collapsed" ? "none" : "auto",
              transition: "opacity 0.2s",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* ── Collapsed: swipe hint ── */}
        {sheetState === "collapsed" && (
          <div style={{ flexShrink: 0, padding: "4px 0 14px", textAlign: "center", pointerEvents: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8DD63F" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.9 }}>
              <path d="M18 15l-6-6-6 6"/>
            </svg>
            <span style={{ fontSize: 16, fontWeight: 800, color: "#fff", letterSpacing: -0.2 }}>
              Swipe up to find parking
            </span>
          </div>
        )}

        {/* ── Half/Full-state: viewport pads list ── */}
        {((sheetState === "half" || sheetState === "full") || (dragging && dragOffset > 20)) && selectedSpot === null && (() => {
          const sortOrigin: [number, number] = searchPin
            ? [searchPin.lat, searchPin.lng]
            : userPos ?? mapCenter;
          // Filter by requested time window when "Park Later" is active
          const toMin = (s: string) => {
            const [h, m] = s.split(":").map(n => parseInt(n || "0", 10));
            return (h || 0) * 60 + (m || 0);
          };
          const startMin = toMin(laterStart);
          const endMin = toMin(laterEnd);
          const validRange = parkMode === "later" && endMin >= startMin + 30;
          const filtered = parkMode === "later" && validRange
            ? viewportSpots.filter(s => {
                const h = getSpotHours(s.id);
                return startMin >= h.openHour * 60 && endMin <= h.closeHour * 60;
              })
            : viewportSpots;
          const pads = [...filtered].sort((a, b) => {
            if (sortMode === "price") {
              return Number(a.price.replace(/[^0-9]/g, "")) - Number(b.price.replace(/[^0-9]/g, ""));
            }
            return haversineKm(a.lat, a.lng, sortOrigin[0], sortOrigin[1])
                 - haversineKm(b.lat, b.lng, sortOrigin[0], sortOrigin[1]);
          });
          const fmtMinLabel = (totalMin: number) => {
            const h = Math.floor(totalMin / 60);
            const m = totalMin % 60;
            const ap = h >= 12 ? "PM" : "AM";
            const hr = h === 0 ? 12 : h > 12 ? h - 12 : h;
            return `${hr}:${String(m).padStart(2,"0")} ${ap}`;
          };
          const minToHHMM = (totalMin: number) => `${String(Math.floor(totalMin/60)).padStart(2,"0")}:${String(totalMin%60).padStart(2,"0")}`;
          const halfHourSlots: { value: string; label: string }[] = Array.from({ length: 48 }, (_, i) => {
            const m = i * 30;
            return { value: minToHHMM(m), label: fmtMinLabel(m) };
          });
          const openTimePicker = (e: React.MouseEvent<HTMLLabelElement>) => {
            const inp = e.currentTarget.querySelector("input") as HTMLInputElement | null;
            if (!inp) return;
            if (typeof (inp as any).showPicker === "function") {
              try { (inp as any).showPicker(); } catch { inp.focus(); inp.click(); }
            } else { inp.focus(); inp.click(); }
          };
          const fmtDateLabelStr = (s: string) => {
            if (!s) return "Pick date";
            const [y,m,d] = s.split("-").map(Number);
            const dt = new Date(y, m-1, d);
            return dt.toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric" });
          };
          return (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
              {/* Park Now / Park Later — visible whenever sheet is open */}
              {sheetState !== "collapsed" && (
                <div
                  onPointerDown={e => e.stopPropagation()}
                  style={{ flexShrink: 0, padding: "4px 16px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <div style={{ display: "flex", background: "rgba(255,255,255,0.06)", borderRadius: 100, padding: 3, gap: 2, marginBottom: parkMode === "later" ? 12 : 4 }}>
                    {(["now","later"] as const).map(m => (
                      <button
                        key={m}
                        onClick={e => { e.stopPropagation(); setParkMode(m); }}
                        style={{
                          flex: 1, padding: "9px 0",
                          fontSize: 12.5, fontWeight: 800, letterSpacing: 0.2,
                          color: parkMode === m ? "#0E1F40" : "rgba(255,255,255,0.55)",
                          background: parkMode === m ? "#fff" : "transparent",
                          border: "none", borderRadius: 100,
                          cursor: "pointer", transition: "all 0.18s",
                          fontFamily: "'DM Sans', sans-serif",
                        }}
                      >
                        {m === "now" ? "Park Now" : "Park Later"}
                      </button>
                    ))}
                  </div>
                  {parkMode === "later" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {/* Date pill */}
                      <label
                        onClick={openTimePicker}
                        style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 14, cursor: "pointer" }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8DD63F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
                        </svg>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 9.5, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 1 }}>Date</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{fmtDateLabelStr(laterDate)}</div>
                        </div>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M6 9l6 6 6-6"/>
                        </svg>
                        <input
                          type="date"
                          value={laterDate}
                          onChange={e => setLaterDate(e.target.value)}
                          min={(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })()}
                          style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", border: "none", background: "transparent" }}
                        />
                      </label>
                      {/* From + To times */}
                      <div style={{ display: "flex", gap: 8 }}>
                        <label
                          onClick={openTimePicker}
                          style={{ position: "relative", flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 14, cursor: "pointer" }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8DD63F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                          </svg>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 9.5, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 1 }}>From</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{fmtMinLabel(startMin)}</div>
                          </div>
                          <select
                            value={laterStart}
                            onChange={e => {
                              const v = e.target.value;
                              setLaterStart(v);
                              const sM = toMin(v);
                              const eM = toMin(laterEnd);
                              if (eM < sM + 30) setLaterEnd(minToHHMM(Math.min(sM + 30, 23*60 + 30)));
                            }}
                            style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", border: "none", background: "transparent", appearance: "none", WebkitAppearance: "none" }}
                          >
                            {halfHourSlots.slice(0, -1).map(s => (
                              <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                          </select>
                        </label>
                        <label
                          onClick={openTimePicker}
                          style={{ position: "relative", flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 14, cursor: "pointer" }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8DD63F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                          </svg>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 9.5, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 1 }}>Till</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{fmtMinLabel(endMin)}</div>
                          </div>
                          <select
                            value={laterEnd}
                            onChange={e => setLaterEnd(e.target.value)}
                            style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", border: "none", background: "transparent", appearance: "none", WebkitAppearance: "none" }}
                          >
                            {halfHourSlots
                              .filter(s => toMin(s.value) >= startMin + 30)
                              .map(s => (
                                <option key={s.value} value={s.value}>{s.label}</option>
                              ))}
                          </select>
                        </label>
                      </div>
                      {!validRange && (
                        <div style={{ fontSize: 11, color: "#fca5a5", fontWeight: 600, padding: "0 4px" }}>
                          Pick an end time after the start time.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Count header + sort toggle */}
              {pads.length > 0 && (
                <div style={{ flexShrink: 0, padding: "4px 16px 10px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.50)", letterSpacing: 0.4, textTransform: "uppercase" }}>
                      {pads.length} pad{pads.length !== 1 ? "s" : ""} nearby
                    </span>
                    <button
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); setOpenFirst(v => !v); }}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        padding: "3px 10px 3px 8px", borderRadius: 100,
                        background: openFirst ? "rgba(141,214,63,0.18)" : "transparent",
                        border: `1px solid ${openFirst ? "rgba(141,214,63,0.55)" : "rgba(255,255,255,0.18)"}`,
                        color: openFirst ? "#8DD63F" : "rgba(255,255,255,0.55)",
                        fontSize: 10, fontWeight: 700, letterSpacing: 0.2,
                        cursor: "pointer", transition: "all 0.18s",
                      }}
                    >
                      Available now
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="4" y1="7"  x2="16" y2="7"  />
                        <line x1="4" y1="12" x2="13" y2="12" />
                        <line x1="4" y1="17" x2="10" y2="17" />
                      </svg>
                    </button>
                  </div>
                  {/* Sort toggle */}
                  <div
                    onPointerDown={e => e.stopPropagation()}
                    style={{ display: "flex", background: "rgba(255,255,255,0.07)", borderRadius: 20, padding: 2, gap: 1 }}
                  >
                    {(["distance", "price"] as const).map(mode => (
                      <button
                        key={mode}
                        onClick={e => { e.stopPropagation(); setSortMode(mode); }}
                        style={{
                          fontSize: 9.5, fontWeight: 700,
                          color: sortMode === mode ? "#0E1F40" : "rgba(255,255,255,0.40)",
                          background: sortMode === mode ? "#fff" : "transparent",
                          border: "none", borderRadius: 16, padding: "3px 8px",
                          cursor: "pointer", letterSpacing: 0.2, transition: "all 0.18s",
                          textTransform: "capitalize",
                        }}
                      >
                        {mode === "distance" ? "↑ Distance" : "$ Price"}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div ref={cardsRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch" as any, touchAction: "pan-y", padding: "4px 16px 16px" }}>
                {pads.length === 0 ? (
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: "36px 0" }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.35)", margin: 0, letterSpacing: 0.1, textAlign: "center" }}>
                      Pan or zoom the map<br />to find pads
                    </p>
                  </div>
                ) : (() => {
                  type Avail = { kind: "open" | "soon" | "later"; openMin: number; closeMin: number; openLabel: string };
                  const computeAvail = (_id: number): Avail => {
                    return { kind: "open", openMin: 0, closeMin: 24 * 60, openLabel: "" };
                  };
                  const padsWithAvail = pads.map(s => ({ spot: s, avail: computeAvail(s.id) }));
                  const grouping = parkMode === "now";
                  let openSoon = grouping ? padsWithAvail.filter(p => p.avail.kind !== "later") : padsWithAvail;
                  if (grouping && openFirst) {
                    const opens = openSoon.filter(p => p.avail.kind === "open");
                    const soons = openSoon.filter(p => p.avail.kind === "soon");
                    openSoon = [...opens, ...soons];
                  }

                  const renderCard = ({ spot, avail }: { spot: typeof pads[number]; avail: Avail }) => {
                    const hostName = spot.host_name || "Host";
                    const parts = spot.meta.split("·").map(s => s.trim());
                    const padType = parts[0];
                    const priceNum = spot.price.replace(/[^0-9]/g, "");
                    const distKm = haversineKm(spot.lat, spot.lng, sortOrigin[0], sortOrigin[1]);
                    const distLabel = formatDist(distKm);
                    const showOpen = grouping && avail.kind === "open";
                    const showSoon = grouping && avail.kind === "soon";
                    return (
                      <div
                        key={spot.id}
                        onClick={() => selectSpot(spot.id)}
                        style={{
                          position: "relative",
                          display: "flex", alignItems: "center", gap: 12,
                          padding: "10px 12px",
                          paddingLeft: showOpen ? 14 : 12,
                          borderRadius: 10,
                          background: "#fff",
                          cursor: "pointer",
                          overflow: "hidden",
                        }}
                      >
                        {showOpen && (
                          <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: "#8DD63F" }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#0E1F40", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {spot.addr}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 10.5, color: "rgba(14,31,64,0.45)" }}>
                              {padType} · {hostName} · {distLabel}
                            </span>
                          </div>
                          {(showOpen || showSoon) && (
                            <div style={{ marginTop: 5, display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 100,
                              background: showOpen ? "rgba(141,214,63,0.14)" : "rgba(245,158,11,0.14)",
                            }}>
                              <span style={{ width: 5, height: 5, borderRadius: "50%", background: showOpen ? "#16A34A" : "#F59E0B" }} />
                              <span style={{ fontSize: 10.5, fontWeight: 700, color: showOpen ? "#15803D" : "#B45309", letterSpacing: 0.1 }}>
                                {showOpen ? "Available" : `Available ~${avail.openLabel}`}
                              </span>
                            </div>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                            <div>
                              <span style={{ fontSize: 15, fontWeight: 800, color: "#0E1F40", letterSpacing: -0.5 }}>${priceNum}</span>
                              <span style={{ fontSize: 9.5, color: "rgba(14,31,64,0.35)", marginLeft: 1 }}>/hr</span>
                            </div>
                          </div>
                          {/* Save button */}
                          <button
                            onPointerDown={e => e.stopPropagation()}
                            onClick={e => { e.stopPropagation(); toggleSave(spot.id); }}
                            style={{
                              display: "flex", alignItems: "center", gap: 5,
                              padding: "8px 14px", borderRadius: 100, flexShrink: 0,
                              background: savedSpots.includes(spot.id) ? "rgba(14,31,64,0.10)" : "transparent",
                              border: `1.5px solid ${savedSpots.includes(spot.id) ? "rgba(14,31,64,0.28)" : "rgba(14,31,64,0.18)"}`,
                              cursor: "pointer", transition: "all 0.18s",
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill={savedSpots.includes(spot.id) ? "#0E1F40" : "none"} stroke="#0E1F40" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                            </svg>
                            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#0E1F40", letterSpacing: 0.1, whiteSpace: "nowrap" }}>
                              {savedSpots.includes(spot.id) ? "Saved" : "Save"}
                            </span>
                          </button>
                        </div>
                      </div>
                    );
                  };
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {openSoon.map(renderCard)}
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })()}

        {/* ── Pad detail dashboard — shown when a spot is selected ── */}
        {selectedSpot !== null && (() => {
          const spot = spots.find(s => s.id === selectedSpot)!;
          const hostName = spot.host_name || "Host";
          const hostInitials = hostName.split(" ").filter(Boolean).map((w: string) => w[0]).join("") || "H";
          const padType = spot.meta.split("·")[0].trim();
          const ALL_GRADIENTS = [
            "linear-gradient(145deg,#1e3a5f 0%,#2d5986 100%)",
            "linear-gradient(145deg,#2d3a2e 0%,#3d5c3f 100%)",
            "linear-gradient(145deg,#3a2a1e 0%,#5c4030 100%)",
            "linear-gradient(145deg,#1e2a3a 0%,#2a3d5c 100%)",
            "linear-gradient(145deg,#3a1e2a 0%,#5c2a3d 100%)",
          ];
          const spotPhotos = spot.photo_urls && spot.photo_urls.length > 0
            ? spot.photo_urls
            : (spot.photo_url ? [spot.photo_url] : []);
          const photoCount = Math.max(spotPhotos.length, 1);
          const PHOTO_GRADIENTS = Array.from({ length: photoCount }, (_, i) =>
            ALL_GRADIENTS[(idHash(spot.id) + i) % ALL_GRADIENTS.length]
          );
          const status = getSpotStatus(spot.id);
          const userBookings = state.bookings.filter(b => b.spotId === spot.id && b.status === "active");
          const nowMs = Date.now();
          const liveBooked = userBookings.some(b => b.startTs <= nowMs && nowMs < b.endTs);
          const isBooked = status === "booked" || liveBooked;
          const conflict = bookStartTs != null && bookEndTs != null && userBookings.some(b => Math.max(b.startTs, bookStartTs) < Math.min(b.endTs, bookEndTs));
          const detailAvail = { kind: "open" as const, openLabel: "" };
          return (
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch" as any, touchAction: "pan-y", display: "flex", flexDirection: "column", scrollbarWidth: "none" }}>

              {/* Photo strip */}
              <div style={{ display: "flex", gap: 8, padding: "4px 16px 14px", overflowX: "auto", flexShrink: 0, scrollbarWidth: "none" } as React.CSSProperties}>
                {PHOTO_GRADIENTS.map((grad, i) => (
                  <div key={i} onClick={() => setLightboxIdx(i)} style={{ flexShrink: 0, width: spotPhotos.length === 1 ? "calc(100% - 0px)" : 200, height: 130, borderRadius: 14, background: grad, border: "1px solid rgba(255,255,255,0.1)", position: "relative", overflow: "hidden", cursor: "pointer" }}>
                    {spotPhotos[i] && (
                      <img src={spotPhotos[i]} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                    )}
                    {i === 0 && spot.featured && (
                      <div style={{ position: "absolute", top: 8, left: 10, fontSize: 9, fontWeight: 700, color: "#8DD63F", letterSpacing: 0.8, textTransform: "uppercase", background: "rgba(0,0,0,0.4)", borderRadius: 6, padding: "2px 6px" }}>✦ Featured</div>
                    )}
                    {spotPhotos.length > 1 && (
                      <div style={{ position: "absolute", bottom: 7, right: 8, fontSize: 10, fontWeight: 700, color: "#fff", background: "rgba(0,0,0,0.45)", borderRadius: 6, padding: "2px 6px" }}>
                        {i + 1}/{spotPhotos.length}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Address + type */}
              <div style={{ padding: "0 16px 10px", flexShrink: 0 }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: "#fff", lineHeight: 1.25, marginBottom: 4 }}>{spot.addr}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>{spot.meta}</span>
                  <span style={{ width: 3, height: 3, borderRadius: "50%", background: "rgba(255,255,255,0.2)", display: "inline-block" }} />
                  {(() => {
                    let pillText: string;
                    let dotColor: string;
                    let bg: string;
                    let border: string;
                    let textColor: string;
                    let glow: string;
                    if (isBooked) {
                      pillText = "Currently booked";
                      dotColor = "#ef4444";
                      bg = "rgba(239,68,68,0.16)";
                      border = "rgba(239,68,68,0.45)";
                      textColor = "#fca5a5";
                      glow = "rgba(239,68,68,0.7)";
                    } else if (detailAvail.kind === "open") {
                      pillText = "Available now";
                      dotColor = "#8DD63F";
                      bg = "rgba(141,214,63,0.18)";
                      border = "rgba(141,214,63,0.45)";
                      textColor = "#8DD63F";
                      glow = "rgba(141,214,63,0.7)";
                    } else if (detailAvail.kind === "soon") {
                      pillText = `Available ~${detailAvail.openLabel}`;
                      dotColor = "#F59E0B";
                      bg = "rgba(245,158,11,0.16)";
                      border = "rgba(245,158,11,0.45)";
                      textColor = "#FBBF24";
                      glow = "rgba(245,158,11,0.7)";
                    } else {
                      pillText = `Opens ${detailAvail.openLabel}`;
                      dotColor = "rgba(255,255,255,0.45)";
                      bg = "rgba(255,255,255,0.08)";
                      border = "rgba(255,255,255,0.18)";
                      textColor = "rgba(255,255,255,0.65)";
                      glow = "rgba(255,255,255,0.25)";
                    }
                    return (
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        padding: "3px 9px", borderRadius: 999,
                        background: bg, border: `1px solid ${border}`,
                        fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
                        color: textColor,
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor, boxShadow: `0 0 6px ${glow}` }} />
                        {pillText}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* Save + Share action row */}
              {(() => {
                const isSaved = savedSpots.includes(spot.id as unknown as number);
                const handleShare = () => {
                  const url = `${window.location.origin}/find`;
                  const text = `Check out this parking spot on Lily Pad: ${spot.addr}`;
                  if (navigator.share) {
                    navigator.share({ title: "Lily Pad Parking", text, url }).catch(() => {});
                  } else {
                    navigator.clipboard.writeText(`${text} — ${url}`).then(() => {
                      setShareToast("Link copied!");
                      setTimeout(() => setShareToast(null), 2200);
                    }).catch(() => {
                      setShareToast("Copy not supported");
                      setTimeout(() => setShareToast(null), 2200);
                    });
                  }
                };
                return (
                  <div style={{ display: "flex", gap: 10, padding: "0 16px 14px", flexShrink: 0 }}>
                    <button
                      onClick={() => toggleSave(spot.id as unknown as number)}
                      style={{
                        flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        minHeight: 48, borderRadius: 100,
                        background: isSaved ? "rgba(141,214,63,0.14)" : "rgba(255,255,255,0.07)",
                        border: `1.5px solid ${isSaved ? "rgba(141,214,63,0.40)" : "rgba(255,255,255,0.14)"}`,
                        cursor: "pointer", transition: "all 0.18s",
                      }}
                    >
                      <svg width="17" height="17" viewBox="0 0 24 24" fill={isSaved ? "#8DD63F" : "none"} stroke={isSaved ? "#8DD63F" : "rgba(255,255,255,0.7)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                      </svg>
                      <span style={{ fontSize: 14, fontWeight: 700, color: isSaved ? "#8DD63F" : "rgba(255,255,255,0.75)", letterSpacing: -0.1 }}>
                        {isSaved ? "Saved" : "Save"}
                      </span>
                    </button>
                    <button
                      onClick={handleShare}
                      style={{
                        flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        minHeight: 48, borderRadius: 100,
                        background: "rgba(255,255,255,0.07)",
                        border: "1.5px solid rgba(255,255,255,0.14)",
                        cursor: "pointer", transition: "all 0.18s",
                      }}
                    >
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                      </svg>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.75)", letterSpacing: -0.1 }}>
                        {shareToast === "Link copied!" ? "Copied!" : "Share"}
                      </span>
                    </button>
                  </div>
                );
              })()}

              {/* Divider */}
              <div style={{ height: 1, background: "rgba(255,255,255,0.07)", margin: "0 16px 14px", flexShrink: 0 }} />

              {/* Amenities */}
              {spot.services && spot.services.length > 0 && (
                <div style={{ padding: "0 16px 14px", flexShrink: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.36)", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 9 }}>Amenities</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                    {spot.services.map(svc => (
                      <span key={svc} style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        background: "rgba(141,214,63,0.10)",
                        border: "1px solid rgba(141,214,63,0.28)",
                        borderRadius: 999, padding: "5px 12px",
                        fontSize: 12, fontWeight: 600, color: "#8DD63F",
                      }}>
                        <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M2 6l3 3 5-5"/></svg>
                        {svc}
                      </span>
                    ))}
                  </div>
                  <div style={{ height: 1, background: "rgba(255,255,255,0.07)", marginTop: 14 }} />
                </div>
              )}

              {/* Host row */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 16px 14px", flexShrink: 0 }}>
                <div style={{ width: 44, height: 44, borderRadius: "50%", background: "linear-gradient(145deg,rgba(141,214,63,0.5),rgba(34,197,94,0.3))", border: "1.5px solid rgba(141,214,63,0.4)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#8DD63F" }}>{hostInitials}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{hostName}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>Pad host · Joined 2023</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>Pad host</div>
                </div>
              </div>


              {/* ── Inline booking ── */}
              {(() => {
                const priceNum = Number(spot.price.replace(/[^0-9]/g, "")) || 0;
                const openHour = 0;
                const closeHour = 24;
                const startD = bookStartTs != null ? new Date(bookStartTs) : null;
                const endD = bookEndTs != null ? new Date(bookEndTs) : null;
                const toDateInput = (d: Date | null) => d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}` : "";
                const toTimeInput = (d: Date | null) => d ? `${String(d.getHours()).padStart(2,"0")}:00` : "";
                const fmtDateLabel = (d: Date | null) => d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
                const fmtTimeLabel = (d: Date | null) => d ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "—";
                const HOUR_MS = 60 * 60 * 1000;
                const updateStartDate = (s: string) => {
                  if (!s || !startD || !endD) return;
                  const [y,m,day] = s.split("-").map(Number);
                  const ns = new Date(startD); ns.setFullYear(y, m-1, day); ns.setMinutes(0,0,0);
                  const dur = Math.max(HOUR_MS, endD.getTime() - startD.getTime());
                  setBookStartTs(ns.getTime()); setBookEndTs(ns.getTime() + dur);
                };
                const updateStartTime = (s: string) => {
                  if (!s || !startD || !endD) return;
                  const [h] = s.split(":").map(Number);
                  const ns = new Date(startD); ns.setHours(h, 0, 0, 0);
                  const dur = Math.max(HOUR_MS, endD.getTime() - startD.getTime());
                  setBookStartTs(ns.getTime()); setBookEndTs(ns.getTime() + dur);
                };
                const updateEndDate = (s: string) => {
                  if (!s || !endD || !startD) return;
                  const [y,m,day] = s.split("-").map(Number);
                  const ne = new Date(endD); ne.setFullYear(y, m-1, day); ne.setMinutes(0,0,0);
                  if (ne.getTime() < startD.getTime() + HOUR_MS) {
                    setBookEndTs(startD.getTime() + HOUR_MS);
                  } else {
                    setBookEndTs(ne.getTime());
                  }
                };
                const updateEndTime = (s: string) => {
                  if (!s || !endD || !startD) return;
                  const [h] = s.split(":").map(Number);
                  const ne = new Date(endD); ne.setHours(h, 0, 0, 0);
                  if (ne.getTime() < startD.getTime() + HOUR_MS) {
                    setBookEndTs(startD.getTime() + HOUR_MS);
                  } else {
                    setBookEndTs(ne.getTime());
                  }
                };
                const durMs = startD && endD ? Math.max(0, endD.getTime() - startD.getTime()) : 0;
                const durHrs = Math.max(1, Math.round(durMs / HOUR_MS));
                const durLabel = durHrs === 1 ? "1 hour" : `${durHrs} hours`;
                const total = Math.round(priceNum * durHrs * 100) / 100;
                // Book now: start = next hour, duration 1 hour
                const now = new Date();
                const nextHour = now.getHours() + 1;
                const nowAvail = !isBooked && nextHour >= openHour && nextHour < closeHour;
                const setBookNow = () => {
                  const s = new Date(); s.setHours(s.getHours() + 1, 0, 0, 0);
                  const e = new Date(s.getTime() + HOUR_MS);
                  setBookStartTs(s.getTime()); setBookEndTs(e.getTime());
                };
                const openPicker = (e: React.MouseEvent<HTMLLabelElement>) => {
                  const inp = e.currentTarget.querySelector("input") as HTMLInputElement | null;
                  if (!inp) return;
                  if (typeof (inp as any).showPicker === "function") {
                    try { (inp as any).showPicker(); } catch { inp.focus(); inp.click(); }
                  } else {
                    inp.focus(); inp.click();
                  }
                };
                const pillStyle: React.CSSProperties = {
                  background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.10)",
                  borderRadius: 999, padding: "9px 16px", color: "#fff", fontSize: 14, fontWeight: 600,
                  fontFamily: '"DM Sans", sans-serif', cursor: "pointer", outline: "none",
                  display: "inline-flex", alignItems: "center", gap: 8, position: "relative", userSelect: "none",
                };
                const hiddenInput: React.CSSProperties = {
                  position: "absolute", inset: 0, width: "100%", height: "100%",
                  opacity: 0, border: "none", padding: 0, margin: 0, cursor: "pointer",
                  colorScheme: "dark" as any,
                };
                return (
                  <div style={{ padding: "0 16px 6px", flexShrink: 0 }}>
                    {/* Price + book now */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                      <div>
                        <span style={{ fontSize: 24, fontWeight: 800, color: "#fff", letterSpacing: -0.8 }}>${priceNum}</span>
                        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginLeft: 3 }}>/ hr</span>
                      </div>
                      {nowAvail && (
                        <button onClick={setBookNow} style={{ background: "rgba(141,214,63,0.14)", border: "1px solid rgba(141,214,63,0.45)", borderRadius: 999, padding: "7px 13px", color: "#8DD63F", fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", cursor: "pointer", fontFamily: '"DM Sans", sans-serif', display: "flex", alignItems: "center", gap: 6 }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg>
                          Next hour · ${priceNum}
                        </button>
                      )}
                    </div>

                    {/* Start time */}
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", marginBottom: 8 }}>Start time</div>
                      <div style={{ display: "flex", gap: 10 }}>
                        <label style={pillStyle} onClick={openPicker}>
                          <span>{fmtDateLabel(startD)}</span>
                          <input type="date" value={toDateInput(startD)} onChange={e => updateStartDate(e.target.value)} style={hiddenInput} />
                        </label>
                        <label style={pillStyle} onClick={openPicker}>
                          <span>{fmtTimeLabel(startD)}</span>
                          <input type="time" step={3600} value={toTimeInput(startD)} onChange={e => updateStartTime(e.target.value)} style={hiddenInput} />
                        </label>
                      </div>
                    </div>

                    {/* End time */}
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", marginBottom: 8 }}>End time</div>
                      <div style={{ display: "flex", gap: 10 }}>
                        <label style={pillStyle} onClick={openPicker}>
                          <span>{fmtDateLabel(endD)}</span>
                          <input type="date" value={toDateInput(endD)} onChange={e => updateEndDate(e.target.value)} style={hiddenInput} />
                        </label>
                        <label style={pillStyle} onClick={openPicker}>
                          <span>{fmtTimeLabel(endD)}</span>
                          <input type="time" step={3600} value={toTimeInput(endD)} onChange={e => updateEndTime(e.target.value)} style={hiddenInput} />
                        </label>
                      </div>
                    </div>

                    {/* Duration + total */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0 6px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                      <span style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>Duration</span>
                      <span style={{ fontSize: 14, color: "#fff", fontWeight: 600 }}>{durLabel}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0 0" }}>
                      <span style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>Total</span>
                      <span style={{ fontSize: 18, color: "#fff", fontWeight: 800, letterSpacing: -0.3 }}>${total.toFixed(2)}</span>
                    </div>
                    {durHrs > (closeHour - openHour) && (
                      <div style={{ fontSize: 11, color: "#fca5a5", marginTop: 8 }}>
                        Heads up — this pad is open {fmtTimeLabel(new Date(2000,0,1,openHour,0))} – {closeHour === 24 ? "12:00 AM" : fmtTimeLabel(new Date(2000,0,1,closeHour,0))}.
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Book my lily pad CTA */}
              <div style={{ padding: "10px 16px 0", paddingBottom: "calc(env(safe-area-inset-bottom) + 18px)", flexShrink: 0, marginTop: "auto" }}>
                <button
                  disabled={isBooked || conflict || bookStartTs == null || bookEndTs == null || bookEndTs <= bookStartTs}
                  onClick={async () => {
                    if (bookStartTs == null || bookEndTs == null || isBooked || conflict) return;
                    const priceNum = Number(spot.price.replace(/[^0-9.]/g, "")) || 0;
                    const padType = (spot.meta.split("·")[0] || "Spot").trim();
                    const uuidDigits = spot.id.replace(/[^0-9]/g, "").padEnd(10, "5");
                    const hostPhone = `(${uuidDigits.slice(0,3)}) ${uuidDigits.slice(3,6)}-${uuidDigits.slice(6,10)}`;
                    const durMs = bookEndTs - bookStartTs;
                    const durHrs = Math.max(1, Math.round(durMs / (60 * 60 * 1000)));
                    const totalPrice = Math.round(priceNum * durHrs * 100) / 100;
                    let confNum = `LP-${Date.now().toString(36).toUpperCase().slice(-6)}`;
                    let bookingUuid: string | undefined;
                    if (user) {
                      try {
                        const r = await fetch("/api/bookings", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            user_id: user.id,
                            spot_id: spot.id,
                            start_ts: new Date(bookStartTs).toISOString(),
                            end_ts: new Date(bookEndTs).toISOString(),
                            price_per_hr: priceNum,
                            total_price: totalPrice,
                            booking_data: { addr: spot.addr, padType, hostName, hostPhone },
                          }),
                        });
                        if (r.ok) {
                          const data = await r.json();
                          if (data?.id) {
                            bookingUuid = String(data.id);
                            confNum = `LP-${bookingUuid.slice(0, 8).toUpperCase()}`;
                          }
                        }
                      } catch { /* non-blocking */ }
                    }
                    setAppState(s => {
                      const newId = s.bookings.reduce((m, b) => Math.max(m, Number(b.id)), 0) + 1;
                      const rec = {
                        id: newId, uuid: bookingUuid,
                        spotId: spot.id, addr: spot.addr, city: "Houston, TX", padType,
                        startTs: bookStartTs, endTs: bookEndTs, pricePerHr: priceNum,
                        hostName, hostPhone, status: "pending" as const,
                      };
                      return { ...s, bookings: [...s.bookings, rec] };
                    });
                    setBookingConf({ addr: spot.addr, padType, startTs: bookStartTs, endTs: bookEndTs, totalPrice, confNum });
                  }}
                  style={{ width: "100%", padding: "15px", background: (isBooked || conflict) ? "rgba(239,68,68,0.25)" : "#8DD63F", border: "none", borderRadius: 100, fontSize: 15, fontWeight: 700, color: (isBooked || conflict) ? "#fca5a5" : "#0E1F40", cursor: (isBooked || conflict) ? "not-allowed" : "pointer", fontFamily: "'DM Sans', sans-serif", letterSpacing: -0.2, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: (isBooked || conflict) ? "none" : "0 2px 16px rgba(141,214,63,0.35)" }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
                  </svg>
                  {isBooked ? "Currently booked" : conflict ? "Time already booked" : "Book my lily pad"}
                </button>
              </div>
            </div>
          );
        })()}
      </div>}

      {/* ── BOOKING CONFIRMATION OVERLAY ── */}
      {!comingSoon && bookingConf && (() => {
        const fmtD = (ts: number) => new Date(ts).toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric" });
        const fmtT = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour:"numeric", minute:"2-digit" });
        const durMs = bookingConf.endTs - bookingConf.startTs;
        const durHrs = Math.round(durMs / 36e5 * 10) / 10;
        return (
          <div style={{
            position: "absolute", inset: 0, zIndex: 300,
            background: "#0E1F40",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            padding: "32px 24px",
            fontFamily: "'DM Sans', sans-serif",
          }}>
            <div style={{ width: "100%", maxWidth: 390, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
              <div style={{
                width: 76, height: 76, borderRadius: "50%",
                background: "rgba(141,214,63,0.15)",
                border: "2px solid rgba(141,214,63,0.40)",
                display: "flex", alignItems: "center", justifyContent: "center",
                marginBottom: 22,
              }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#8DD63F" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#fff", letterSpacing: -0.5, marginBottom: 6 }}>Booking Confirmed!</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", marginBottom: 28 }}>Your spot is reserved and saved to your account.</div>

              <div style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 18, padding: "18px 20px", marginBottom: 24, textAlign: "left" }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 4, letterSpacing: -0.3 }}>{bookingConf.addr}</div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", marginBottom: 18 }}>{bookingConf.padType}</div>
                {[
                  { label: "Date",    val: fmtD(bookingConf.startTs) },
                  { label: "Time",    val: `${fmtT(bookingConf.startTs)} → ${fmtT(bookingConf.endTs)} (${durHrs}h)` },
                  { label: "Total",   val: `$${bookingConf.totalPrice.toFixed(2)}` },
                  { label: "Conf #",  val: bookingConf.confNum },
                ].map(({ label, val }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.40)", fontWeight: 600 }}>{label}</span>
                    <span style={{ fontSize: 13, color: "#fff", fontWeight: 700 }}>{val}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={() => { setBookingConf(null); goTo("bookings"); }}
                style={{ width: "100%", padding: "15px 0", borderRadius: 100, background: "#8DD63F", border: "none", cursor: "pointer", fontSize: 15, fontWeight: 700, color: "#0E1F40", fontFamily: "'DM Sans', sans-serif", marginBottom: 12, boxShadow: "0 4px 20px rgba(141,214,63,0.35)" }}
              >
                View my bookings
              </button>
              <button
                onClick={() => { setBookingConf(null); setSelectedSpot(null); }}
                style={{ width: "100%", padding: "13px 0", borderRadius: 100, background: "transparent", border: "1px solid rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.55)", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}
              >
                Back to map
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── ACCOUNT PULL-DOWN DRAWER ── */}
      <div
        style={{
          position: "absolute", top: 0, left: 0, right: 0,
          height: "100%",
          zIndex: 35,
          pointerEvents: acctVisible ? "auto" : "none",
          transform: `translateY(${effectiveAcctTransY}px)`,
          transition: acctDragging
            ? "none"
            : acctSnapDir.current === "open"
              ? "transform 0.54s cubic-bezier(0.34,1.48,0.64,1)"   // spring: snaps open with pull
              : "transform 0.38s cubic-bezier(0.22,1,0.36,1)",      // ease-out: retreats cleanly
          display: "flex", flexDirection: "column",
          background: `rgba(14,31,64,${acctBgAlpha.toFixed(3)})`,
          backdropFilter: `blur(${acctBlurPx}px)`,
          WebkitBackdropFilter: `blur(${acctBlurPx}px)`,
          borderRadius: "0 0 28px 28px",
          boxShadow: "0 4px 40px rgba(0,0,0,0.45)",
          border: "1px solid rgba(255,255,255,0.09)",
          borderTop: "none",
          willChange: "transform",
        }}
      >
        {/* ── Content area (top of panel) ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "calc(env(safe-area-inset-top) + 48px) 24px 0", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Avatar + name block */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "0 0 20px" }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: state.profilePhotoUrl ? `url(${state.profilePhotoUrl}) center/cover` : "linear-gradient(145deg,rgba(141,214,63,0.45),rgba(34,197,94,0.28))", border: "1.5px solid rgba(141,214,63,0.38)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" }}>
              {!state.profilePhotoUrl && (
                <span style={{ fontSize: 20, fontWeight: 700, color: "#8DD63F" }}>
                  {((profile?.first_name?.[0] || state.drAns[0]?.[0] || "") + (profile?.last_name?.[0] || state.drAns[1]?.[0] || "")).toUpperCase() || "·"}
                </span>
              )}
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, color: "#fff", letterSpacing: -0.3 }}>
                {`${profile?.first_name || state.drAns[0] || state.suAns[0] || ""} ${profile?.last_name || state.drAns[1] || state.suAns[1] || ""}`.trim() || "My Account"}
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.50)", marginTop: 2 }}>{profile?.email || state.drAns[2] || state.suAns[2] || ""}</div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: "rgba(255,255,255,0.09)", marginBottom: 4 }} />

          {/* Menu items */}
          {acctView === "menu" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>

              {/* ── Nav items grouped in one card ── */}
              {(() => {
                const userTickets = supportTickets.filter(t => t.userId === supportUserId.current);
                const openCount = userTickets.filter(t => t.status === "open").length;
                const upcoming = state.bookings.filter(b => b.status === "active" && b.endTs > Date.now()).length;
                const items = [
                  {
                    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
                    label: "My Account",
                    sub: "Photo & personal info",
                    lister: false,
                    accent: false,
                    onClick: () => { setAcctOpen(false); acctOpenRef.current = false; goTo(state.accountType === "padRenter" ? "account" : "driveraccount"); },
                  },
                  {
                    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>,
                    label: "My Bookings",
                    sub: upcoming > 0 ? `${upcoming} upcoming` : "Past & upcoming",
                    lister: false,
                    accent: false,
                    onClick: () => { setAcctOpen(false); acctOpenRef.current = false; goTo("bookings"); },
                  },
                  {
                    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
                    label: "My Pads",
                    sub: myHostSpots.length > 0 ? `${myHostSpots.length} listing${myHostSpots.length !== 1 ? "s" : ""}` : "Manage your listings",
                    lister: true,
                    accent: true,
                    onClick: () => { setAcctOpen(false); acctOpenRef.current = false; goTo("paddashboard"); },
                  },
                  {
                    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
                    label: "My Reservations",
                    sub: "New requests & bookings",
                    lister: true,
                    accent: false,
                    onClick: () => { setAcctOpen(false); acctOpenRef.current = false; goTo("listerbookings"); },
                  },
                  {
                    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>,
                    label: "Customer Service",
                    sub: openCount > 0 ? `${openCount} open conversation${openCount !== 1 ? "s" : ""}` : "Get help",
                    lister: false,
                    accent: false,
                    onClick: () => { setAcctOpen(false); acctOpenRef.current = false; goTo("customerservice"); },
                  },
                  {
                    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
                    label: "Saved Spots",
                    sub: savedSpots.length > 0 ? `${savedSpots.length} saved` : "None saved yet",
                    lister: false,
                    accent: false,
                    onClick: () => { setAcctOpen(false); acctOpenRef.current = false; goTo("savedspots"); },
                  },
                ].filter(item => !item.lister || drawerMode === "lister");
                return (
                  <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 14, border: "1px solid rgba(255,255,255,0.10)", overflow: "hidden" }}>
                    {items.map((item, idx) => {
                      const isAccent = item.accent;
                      return (
                        <div key={item.label}>
                          {idx > 0 && <div style={{ height: 1, background: "rgba(255,255,255,0.07)", marginLeft: 44 }} />}
                          <div onClick={item.onClick} style={{
                            display: "flex", alignItems: "center", gap: 12,
                            padding: "11px 14px", cursor: "pointer",
                            background: isAccent ? "rgba(141,214,63,0.07)" : "transparent",
                          }}>
                            <div style={{ width: 32, height: 32, borderRadius: 9, background: isAccent ? "rgba(141,214,63,0.16)" : "rgba(255,255,255,0.09)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: isAccent ? "#8DD63F" : "rgba(255,255,255,0.70)" }}>
                              {item.icon}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13.5, fontWeight: 600, color: isAccent ? "#8DD63F" : "#fff", letterSpacing: -0.1 }}>{item.label}</div>
                              <div style={{ fontSize: 11, color: isAccent ? "rgba(141,214,63,0.55)" : "rgba(255,255,255,0.42)", marginTop: 1 }}>{item.sub}</div>
                            </div>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={isAccent ? "rgba(141,214,63,0.50)" : "rgba(255,255,255,0.25)"} strokeWidth="2.5" strokeLinecap="round"><path d="m9 18 6-6-6-6"/></svg>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* ── Driver / Lister toggle ── */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 4px 2px" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.38)", textTransform: "uppercase", letterSpacing: 0.8 }}>Mode</span>
                <div style={{ display: "flex", background: "rgba(255,255,255,0.07)", borderRadius: 20, padding: 2, border: "1px solid rgba(255,255,255,0.12)" }}>
                  {(["driver", "lister"] as const).map(m => (
                    <button key={m} onClick={() => setDrawerMode(m)} style={{
                      background: drawerMode === m ? "#8DD63F" : "transparent",
                      color: drawerMode === m ? "#0E1F40" : "rgba(255,255,255,0.55)",
                      border: "none", borderRadius: 16, padding: "5px 14px",
                      fontSize: 11, fontWeight: 700, cursor: "pointer",
                      fontFamily: '"DM Sans", sans-serif',
                      transition: "background 0.15s, color 0.15s",
                    }}>{m === "driver" ? "Driver" : "Lister"}</button>
                  ))}
                </div>
              </div>

              {/* ── Lister section ── */}
              {drawerMode === "lister" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {myHostSpots.length === 0 ? (
                    <button onClick={() => { setAcctOpen(false); acctOpenRef.current = false; goTo("padtype"); }} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      width: "100%", padding: "11px 14px", borderRadius: 12,
                      background: "rgba(141,214,63,0.06)", border: "1.5px dashed rgba(141,214,63,0.35)",
                      cursor: "pointer", fontFamily: '"DM Sans", sans-serif', textAlign: "left",
                    }}>
                      <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(141,214,63,0.14)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#8DD63F" }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#8DD63F", letterSpacing: -0.1 }}>List your spot on lily pad</div>
                        <div style={{ fontSize: 11, color: "rgba(141,214,63,0.50)", marginTop: 0.5 }}>Earn money from your parking space</div>
                      </div>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(141,214,63,0.45)" strokeWidth="2.5" strokeLinecap="round"><path d="m9 18 6-6-6-6"/></svg>
                    </button>
                  ) : (
                    <>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.38)", letterSpacing: 0.7, textTransform: "uppercase", padding: "2px 4px" }}>
                        Your spots · {myHostSpots.length}
                      </div>
                      <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.10)", overflow: "hidden" }}>
                        {myHostSpots.map((spot, idx) => (
                          <div key={spot.id}>
                            {idx > 0 && <div style={{ height: 1, background: "rgba(255,255,255,0.07)", marginLeft: 42 }} />}
                            <div onClick={() => { setManagingSpot(spot); setAcctView("manage-spot"); }} style={{
                              display: "flex", alignItems: "center", gap: 10,
                              padding: "10px 14px", cursor: "pointer",
                            }}>
                              <div style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(141,214,63,0.16)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#8DD63F" }}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{spot.addr}</div>
                                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.42)", marginTop: 0.5 }}>{spot.price} · {spot.meta.split("·")[0].trim()}</div>
                              </div>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2.5" strokeLinecap="round"><path d="m9 18 6-6-6-6"/></svg>
                            </div>
                          </div>
                        ))}
                      </div>
                      <button onClick={() => { setAcctOpen(false); acctOpenRef.current = false; goTo("padtype"); }} style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                        width: "100%", padding: "9px", borderRadius: 10,
                        background: "transparent", border: "1.5px dashed rgba(141,214,63,0.30)",
                        cursor: "pointer", fontFamily: '"DM Sans", sans-serif',
                        fontSize: 12, fontWeight: 700, color: "rgba(141,214,63,0.8)",
                      }}>+ Add spot</button>
                    </>
                  )}
                </div>
              )}

              {/* Sign out */}
              <button onClick={() => { authSignOut().then(() => goTo("home")); }} style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "9px 14px", borderRadius: 10,
                background: "transparent", border: "1px solid rgba(239,68,68,0.15)",
                cursor: "pointer", fontFamily: '"DM Sans", sans-serif',
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(239,68,68,0.70)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(239,68,68,0.75)" }}>Sign out</span>
              </button>
            </div>
          ) : acctView === "account" ? (
            /* ── My Account view (photo + minimal personal info) ── */
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
                <button onClick={() => setAcctView("menu")} style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.7)", flexShrink: 0 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
                </button>
                <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", letterSpacing: -0.2 }}>My Account</span>
              </div>

              {/* Profile photo */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 22 }}>
                <input ref={photoInputRef} type="file" accept="image/*" onChange={onProfilePhotoPick} style={{ display: "none" }} />
                <div
                  onClick={() => photoInputRef.current?.click()}
                  style={{
                    width: 96, height: 96, borderRadius: "50%",
                    background: state.profilePhotoUrl ? `url(${state.profilePhotoUrl}) center/cover` : "rgba(141,214,63,0.15)",
                    border: "2px solid rgba(141,214,63,0.35)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", position: "relative", overflow: "hidden",
                  }}
                >
                  {!state.profilePhotoUrl && (
                    <span style={{ fontSize: 30, fontWeight: 800, color: "#8DD63F", letterSpacing: -1 }}>
                      {((profile?.first_name?.[0] || state.drAns[0]?.[0] || "") + (profile?.last_name?.[0] || state.drAns[1]?.[0] || "")).toUpperCase() || "·"}
                    </span>
                  )}
                  <div style={{ position: "absolute", bottom: 0, right: 0, background: "#8DD63F", border: "2px solid #1a1a1f", width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#0E1F40" }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                  </div>
                </div>
                <button onClick={() => photoInputRef.current?.click()} style={{ background: "none", border: "none", color: "#8DD63F", fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>
                  {state.profilePhotoUrl ? "Change photo" : "Upload photo"}
                </button>
              </div>

              {/* Editable info */}
              <div style={{ background: "rgba(52,52,58,0.55)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "4px 14px" }}>
                {([
                  { label: "First name", value: profile?.first_name || state.drAns[0] || state.suAns[0] || "", onChange: (v: string) => setAcctField(0, v), placeholder: "First" },
                  { label: "Last name",  value: profile?.last_name  || state.drAns[1] || state.suAns[1] || "", onChange: (v: string) => setAcctField(1, v), placeholder: "Last" },
                  { label: "Email",      value: profile?.email      || state.drAns[2] || state.suAns[2] || "", onChange: (v: string) => setAcctField(2, v), placeholder: "you@email.com" },
                  { label: "Phone",      value: profile?.phone      || state.drAns[3] || state.suAns[3] || "", onChange: (v: string) => setAcctField(3, v), placeholder: "(555) 123-4567" },
                  ...(state.accountType === "renter" ? [{ label: "Vehicle", value: state.drAns[4] || "", onChange: (v: string) => setVehicle(v), placeholder: "Year Make Model" }] : []),
                ]).map((f, i, arr) => (
                  <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "11px 0", borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.40)", letterSpacing: 0.6, textTransform: "uppercase" }}>{f.label}</span>
                    <input
                      value={f.value}
                      onChange={e => f.onChange(e.target.value)}
                      placeholder={f.placeholder}
                      style={{ background: "transparent", border: "none", outline: "none", color: "#fff", fontSize: 14, fontWeight: 500, fontFamily: '"DM Sans",sans-serif', padding: 0, width: "100%" }}
                    />
                  </div>
                ))}
              </div>
              <p style={{ textAlign: "center", fontSize: 10.5, color: "rgba(255,255,255,0.32)", margin: "14px 0 0", letterSpacing: 0.3 }}>
                Changes save automatically · syncs to both account types
              </p>
            </div>
          ) : acctView === "bookings" ? (
            /* ── My Bookings view ── */
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <button onClick={() => setAcctView("menu")} style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.7)", flexShrink: 0 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
                </button>
                <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", letterSpacing: -0.2 }}>My Bookings</span>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginLeft: 2 }}>{state.bookings.length} total</span>
              </div>
              {state.bookings.length === 0 ? (
                <div style={{ textAlign: "center", padding: "32px 0", color: "rgba(255,255,255,0.30)", fontSize: 13 }}>
                  No bookings yet.<br/>
                  <span style={{ fontSize: 11 }}>Book a spot to see it here.</span>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {state.bookings.map(b => {
                    const bspot = spots.find(s => s.id === b.spotId);
                    const isActive = b.status === "active" && b.endTs > Date.now();
                    const isPast = b.endTs <= Date.now();
                    return (
                      <div key={b.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px", borderRadius: 12, background: isActive ? "rgba(141,214,63,0.08)" : "rgba(255,255,255,0.04)", border: `1px solid ${isActive ? "rgba(141,214,63,0.22)" : "rgba(255,255,255,0.07)"}` }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: isActive ? "rgba(141,214,63,0.15)" : "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: isActive ? "#8DD63F" : "rgba(255,255,255,0.4)" }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bspot ? bspot.addr : String(b.spotId)}</div>
                          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.40)", marginTop: 2 }}>
                            {new Date(b.startTs).toLocaleDateString()} · {new Date(b.startTs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        </div>
                        <div style={{ flexShrink: 0 }}>
                          <div style={{ fontSize: 10.5, fontWeight: 700, color: isActive ? "#8DD63F" : isPast ? "rgba(255,255,255,0.30)" : "rgba(255,200,50,0.80)", background: isActive ? "rgba(141,214,63,0.12)" : isPast ? "rgba(255,255,255,0.06)" : "rgba(255,200,50,0.10)", border: `1px solid ${isActive ? "rgba(141,214,63,0.25)" : isPast ? "rgba(255,255,255,0.10)" : "rgba(255,200,50,0.25)"}`, borderRadius: 6, padding: "2px 7px", textTransform: "uppercase", letterSpacing: 0.4 }}>
                            {isActive ? "Active" : isPast ? "Past" : b.status}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : acctView === "support" ? (
            /* ── Customer Service view ── */
            (() => {
              // Customer's open conversations — once a ticket is resolved we hide it from this list,
              // but the thread itself stays accessible if they happen to be inside it (handled by activeTicket below).
              const myTickets = supportTickets
                .filter(t => t.userId === supportUserId.current && t.status !== "resolved")
                .sort((a, b) => b.updatedAt - a.updatedAt);
              const activeTicket = activeTicketId ? supportTickets.find(t => t.id === activeTicketId) || null : null;
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {supportView === "menu" ? (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                        <button onClick={() => setAcctView("menu")} style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.7)", flexShrink: 0 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
                        </button>
                        <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", letterSpacing: -0.2 }}>Customer Service</span>
                      </div>

                      <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.55)", margin: "0 0 14px", lineHeight: 1.45 }}>
                        How can we help? Start a chat with a real Lilypad rep — they usually reply within a few minutes.
                      </p>

                      <button
                        onClick={() => startNewChat()}
                        style={{ background: "#8DD63F", color: "#0E1F40", border: "none", borderRadius: 14, padding: "16px 16px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', textAlign: "left", marginBottom: 18, width: "100%" }}
                      >
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(14,31,64,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: -0.2 }}>Chat with a rep</div>
                          <div style={{ fontSize: 10.5, fontWeight: 600, opacity: 0.78, marginTop: 2 }}>Live · usually a few minutes</div>
                        </div>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="m9 18 6-6-6-6"/></svg>
                      </button>

                      <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.40)", letterSpacing: 0.6, textTransform: "uppercase", margin: "0 0 8px" }}>
                        Your conversations {myTickets.length > 0 && <span style={{ color: "rgba(255,255,255,0.30)", fontWeight: 500 }}>· {myTickets.length}</span>}
                      </div>
                      {myTickets.length === 0 ? (
                        <div style={{ textAlign: "center", padding: "22px 8px", color: "rgba(255,255,255,0.32)", fontSize: 12.5, background: "rgba(255,255,255,0.03)", borderRadius: 12, border: "1px dashed rgba(255,255,255,0.10)" }}>
                          No conversations yet.
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {myTickets.map(t => {
                            const last = t.messages[t.messages.length - 1];
                            const unreadFromAgent = last && last.from !== "user";
                            return (
                              <div key={t.id} onClick={() => { setActiveTicketId(t.id); setSupportView("thread"); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)", cursor: "pointer" }}>
                                <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(141,214,63,0.18)", color: "#8DD63F", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.subject}</span>
                                    {t.status === "pending_resolution" && (
                                      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", padding: "2px 6px", borderRadius: 5, color: "#FACC15", background: "rgba(250,204,21,0.16)" }}>Pending</span>
                                    )}
                                    {t.status === "resolved" && (
                                      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", padding: "2px 6px", borderRadius: 5, color: "#9DBEFF", background: "rgba(120,170,255,0.16)" }}>Resolved</span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: 11, color: unreadFromAgent ? "#8DD63F" : "rgba(255,255,255,0.45)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: unreadFromAgent ? 700 : 400 }}>
                                    {ticketLastPreview(t)}
                                  </div>
                                </div>
                                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", flexShrink: 0 }}>{formatSupportTime(t.updatedAt)}</div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  ) : supportView === "thread" && activeTicket ? (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                        <button onClick={() => { setSupportView("menu"); setActiveTicketId(null); }} style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.7)", flexShrink: 0 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
                        </button>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", letterSpacing: -0.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeTicket.subject}</div>
                          <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.45)" }}>
                            Live chat · {activeTicket.status === "open" ? "Open" : activeTicket.status === "pending_resolution" ? "Pending resolution" : "Resolved"}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 4px 12px", maxHeight: 280, overflowY: "auto" }}>
                        {activeTicket.messages.map(m => {
                          const isUser = m.from === "user";
                          const isBot = m.from === "bot";
                          return (
                            <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start" }}>
                              {!isUser && (
                                <div style={{ fontSize: 10, fontWeight: 700, color: isBot ? "#8DD63F" : "#9DBEFF", letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 3, paddingLeft: 4 }}>
                                  {isBot ? "Lily · Support bot" : `${m.agentName || "Support rep"}`}
                                </div>
                              )}
                              <div style={{
                                maxWidth: "82%",
                                padding: "9px 13px",
                                borderRadius: 14,
                                background: isUser ? "#8DD63F" : isBot ? "rgba(141,214,63,0.14)" : "rgba(255,255,255,0.10)",
                                color: isUser ? "#0E1F40" : "#fff",
                                fontSize: 13,
                                lineHeight: 1.4,
                                fontWeight: isUser ? 600 : 500,
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                              }}>{m.text}</div>
                              <div style={{ fontSize: 9.5, color: "rgba(255,255,255,0.32)", marginTop: 3, padding: "0 4px" }}>{formatSupportTime(m.ts)}</div>
                            </div>
                          );
                        })}
                        <div ref={threadEndRef} />
                      </div>

                      {activeTicket.status === "resolved" ? (
                        <div style={{ background: "rgba(120,170,255,0.10)", border: "1px solid rgba(120,170,255,0.25)", borderRadius: 12, padding: "10px 12px", color: "rgba(255,255,255,0.72)", fontSize: 12, textAlign: "center" }}>
                          This conversation was marked resolved. Send a new message to reopen it.
                        </div>
                      ) : null}
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <input
                          value={chatDraft}
                          onChange={e => setChatDraft(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendUserMessage(activeTicket.id, chatDraft); } }}
                          placeholder="Type a message…"
                          style={{ flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 100, padding: "11px 16px", color: "#fff", fontSize: 13, fontFamily: '"DM Sans",sans-serif', outline: "none" }}
                        />
                        <button
                          onClick={() => sendUserMessage(activeTicket.id, chatDraft)}
                          disabled={!chatDraft.trim()}
                          style={{ background: chatDraft.trim() ? "#8DD63F" : "rgba(141,214,63,0.30)", color: "#0E1F40", border: "none", borderRadius: "50%", width: 42, height: 42, display: "flex", alignItems: "center", justifyContent: "center", cursor: chatDraft.trim() ? "pointer" : "default", flexShrink: 0 }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              );
            })()
          ) : acctView === "manage-spot" && managingSpot ? (
            /* ── Manage Spot view ── */
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <button onClick={() => { setManagingSpot(null); setAcctView("menu"); }} style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.7)", flexShrink: 0 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
                </button>
                <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", letterSpacing: -0.2 }}>Manage Spot</span>
              </div>
              <div style={{ padding: "14px 16px", borderRadius: 14, background: "rgba(52,52,58,0.70)", border: "1px solid rgba(255,255,255,0.09)" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", letterSpacing: -0.2 }}>{managingSpot.addr}</div>
                <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.40)", marginTop: 3 }}>{managingSpot.price} · {managingSpot.meta}</div>
              </div>
              {[
                { label: "Edit listing", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>, onClick: () => { setAcctOpen(false); acctOpenRef.current = false; goTo("paddashboard"); } },
                { label: "View on map", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>, onClick: () => { setAcctOpen(false); acctOpenRef.current = false; setGlobeMode(false); setMapCenter([managingSpot.lat, managingSpot.lng]); setMapZoom(NEIGHBORHOOD_ZOOM); } },
              ].map(action => (
                <div key={action.label} onClick={action.onClick} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 16px", borderRadius: 12, background: "rgba(52,52,58,0.50)", border: "1px solid rgba(255,255,255,0.07)", cursor: "pointer" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "rgba(255,255,255,0.55)" }}>
                    {action.icon}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{action.label}</div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2.2" strokeLinecap="round" style={{ marginLeft: "auto" }}><path d="m9 18 6-6-6-6"/></svg>
                </div>
              ))}
            </div>
          ) : acctView === "saved" ? (
            /* ── Saved pads view ── */
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {/* Back header */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <button onClick={() => setAcctView("menu")} style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.7)", flexShrink: 0 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
                </button>
                <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", letterSpacing: -0.2 }}>Saved Pads</span>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginLeft: 2 }}>{savedSpots.length} saved</span>
              </div>
              {savedSpots.length === 0 ? (
                <div style={{ textAlign: "center", padding: "32px 0", color: "rgba(255,255,255,0.30)", fontSize: 13 }}>
                  No saved pads yet.<br/>
                  <span style={{ fontSize: 11 }}>Tap ☆ Save on any spot in the list.</span>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {savedSpots.map(id => {
                    const spot = spots.find(s => s.id === id);
                    if (!spot) return null;
                    const priceNum = spot.price.replace(/[^0-9]/g, "");
                    const parts = spot.meta.split("·").map(s => s.trim());
                    return (
                      <div key={id} onClick={() => {
                        setAcctOpen(false);
                        acctOpenRef.current = false;
                        setGlobeMode(false);
                        setMapCenter([spot.lat, spot.lng]);
                        setMapZoom(NEIGHBORHOOD_ZOOM);
                        setSelectedSpot(id);
                        setSheetState("half");
                      }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)", cursor: "pointer" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{spot.addr}</div>
                          <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.40)", marginTop: 2 }}>{parts[0]}</div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 800, color: "#8DD63F" }}>${priceNum}<span style={{ fontSize: 9, fontWeight: 500, color: "rgba(141,214,63,0.55)" }}>/hr</span></div>
                        </div>
                        <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); toggleSave(id); }} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.35)", padding: 4, flexShrink: 0 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="#8DD63F" stroke="#8DD63F" strokeWidth="2" strokeLinecap="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* ── Handle grab area — sits at the bottom of the panel ── */}
        <div
          onPointerDown={onAcctPointerDown}
          onPointerMove={onAcctPointerMove}
          onPointerUp={onAcctPointerUp}
          onPointerCancel={onAcctPointerUp}
          style={{
            flexShrink: 0,
            height: ACCT_PEEK,
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 5,
            touchAction: "none", cursor: acctDragging ? "grabbing" : "grab",
            userSelect: "none",
            borderTop: "1px solid rgba(255,255,255,0.10)",
            background: "linear-gradient(to bottom, rgba(14,31,64,0) 0%, rgba(14,31,64,0.12) 55%, rgba(14,31,64,0.28) 100%)",
            padding: "8px 0 10px",
            borderBottomLeftRadius: 28,
            borderBottomRightRadius: 28,
          }}
        >
          {/* Grab pill */}
          <div style={{ width: 44, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.45)" }} />
          {/* Label */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: "#fff", letterSpacing: 0.2 }}>Account</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8DD63F" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </div>
        </div>
      </div>

      {/* ── HOST DASHBOARD ── */}
      {drawerMode === "lister" && (() => {
        const now = Date.now();
        const RANGE_MS: Record<string, number> = { D: 86400000, W: 604800000, M: 2592000000, Y: 31536000000, ALL: 0 };
        const RANGE_COUNT: Record<string, number> = { D: 24, W: 7, M: 10, Y: 12, ALL: 10 };
        const RANGE_FMT: Record<string, (ts: number) => string> = {
          D:   ts => `${new Date(ts).getHours()}:00`,
          W:   ts => ['Su','Mo','Tu','We','Th','Fr','Sa'][new Date(ts).getDay()],
          M:   ts => new Date(ts).toLocaleDateString('en-US', { month:'short', day:'numeric' }),
          Y:   ts => ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][new Date(ts).getMonth()],
          ALL: ts => new Date(ts).toLocaleDateString('en-US', { month:'short', year:'2-digit' }),
        };
        const count = RANGE_COUNT[earningsRange];
        const rangeStart = earningsRange === 'ALL'
          ? (hostBookings.length > 0 ? Math.min(...hostBookings.map(b => b.start_ts || now)) : now - 31536000000)
          : now - RANGE_MS[earningsRange];
        const bucketMs = earningsRange === 'ALL'
          ? Math.max(Math.floor((now - rangeStart) / count), 86400000)
          : RANGE_MS[earningsRange] / count;

        const chartData = Array.from({ length: count }, (_, i) => {
          const bs = rangeStart + i * bucketMs;
          const earn = hostBookings.filter(b => b.start_ts >= bs && b.start_ts < bs + bucketMs).reduce((s, b) => s + b.total_price, 0);
          return { ts: bs, earnings: earn, label: RANGE_FMT[earningsRange](bs) };
        });
        const totalEarnings = chartData.reduce((s, p) => s + p.earnings, 0);
        const maxEarnings = Math.max(...chartData.map(p => p.earnings), 0.01);
        const bookingCount = hostBookings.filter(b => b.start_ts >= rangeStart).length;

        // SVG chart geometry
        const CW = 360, CH = 185, PL = 8, PR = 8, PT = 18, PB = 32;
        const cw = CW - PL - PR, ch = CH - PT - PB;
        const pts = chartData.map((d, i) => ({
          x: PL + (count > 1 ? (i / (count - 1)) * cw : cw / 2),
          y: PT + ch - (d.earnings / maxEarnings) * ch,
          earnings: d.earnings, label: d.label,
        }));

        // Catmull-Rom smooth path
        const smoothPath = (points: typeof pts) => {
          if (points.length < 2) return '';
          let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
          for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[Math.max(0, i - 1)];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = points[Math.min(points.length - 1, i + 2)];
            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = p1.y + (p2.y - p0.y) / 6;
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = p2.y - (p3.y - p1.y) / 6;
            d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
          }
          return d;
        };
        const linePath = smoothPath(pts);
        const areaPath = pts.length >= 2
          ? `${linePath} L ${pts[pts.length-1].x.toFixed(1)} ${(PT+ch).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(PT+ch).toFixed(1)} Z`
          : '';
        const scrubPt = chartScrubIdx !== null ? pts[Math.max(0, Math.min(pts.length-1, chartScrubIdx))] : null;
        const labelStep = Math.max(1, Math.floor(pts.length / 4));
        const labelIdxs = pts.map((_, i) => i).filter(i => i === 0 || i === pts.length-1 || i % labelStep === 0);

        const onCDown = (e: React.PointerEvent<SVGSVGElement>) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const r = e.currentTarget.getBoundingClientRect();
          setChartScrubIdx(Math.max(0, Math.min(pts.length-1, Math.round(((e.clientX - r.left) / r.width) * (pts.length-1)))));
        };
        const onCMove = (e: React.PointerEvent<SVGSVGElement>) => {
          if (e.buttons === 0) return;
          const r = e.currentTarget.getBoundingClientRect();
          setChartScrubIdx(Math.max(0, Math.min(pts.length-1, Math.round(((e.clientX - r.left) / r.width) * (pts.length-1)))));
        };

        const DASH_NAVY = "#0E1F40";
        const DASH_GREEN = "#8DD63F";

        // ── Earnings detail metrics ──
        const allTimeTotal   = hostBookings.reduce((s, b) => s + b.total_price, 0);
        const allTimeCount   = hostBookings.length;
        const todayEarn      = hostBookings.filter(b => b.start_ts >= now - 86400000).reduce((s, b) => s + b.total_price, 0);
        const weekEarn       = hostBookings.filter(b => b.start_ts >= now - 604800000).reduce((s, b) => s + b.total_price, 0);
        const monthEarn      = hostBookings.filter(b => b.start_ts >= now - 2592000000).reduce((s, b) => s + b.total_price, 0);
        const confirmedTotal = hostBookings.filter(b => b.status === 'approved').reduce((s, b) => s + b.total_price, 0);
        const confirmedCount = hostBookings.filter(b => b.status === 'approved').length;
        const pendingTotal   = hostBookings.filter(b => b.status === 'pending').reduce((s, b) => s + b.total_price, 0);
        const pendingCount   = hostBookings.filter(b => b.status === 'pending').length;
        const avgPerBooking  = allTimeCount > 0 ? allTimeTotal / allTimeCount : 0;

        type HostPageId = "paddashboard" | "listerbookings" | "padtype" | "customerservice";
        type HostAction = { label: string; sub: string; icon: React.ReactNode; page?: HostPageId; onPress?: () => void; accent: boolean };
        const actions: HostAction[] = [
          { label: "Earnings", sub: `$${allTimeTotal.toFixed(2)} all time`, onPress: () => setHostDashView('earnings'), accent: true, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> },
          { label: "My Pads", sub: myHostSpots.length > 0 ? `${myHostSpots.length} listing${myHostSpots.length !== 1 ? 's' : ''}` : "Manage listings", page: "paddashboard", accent: false, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> },
          { label: "Reservations", sub: "Requests & bookings", page: "listerbookings", accent: false, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> },
          { label: "List New Spot", sub: "Add a parking space", page: "padtype", accent: false, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg> },
          { label: "Support", sub: "Get help", page: "customerservice", accent: false, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg> },
        ];

        // Shared chart + earnings headline block (navy section, used in both views)
        const chartBlock = (
          <>
            <div style={{ padding: "0 20px 4px", flexShrink: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.32)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>
                {scrubPt ? scrubPt.label : earningsRange === 'D' ? "Today" : earningsRange === 'W' ? "This Week" : earningsRange === 'M' ? "This Month" : earningsRange === 'Y' ? "This Year" : "All Time"}
              </div>
              <div style={{ fontSize: 38, fontWeight: 800, color: "#fff", letterSpacing: -1.8, lineHeight: 1 }}>
                ${(scrubPt ? scrubPt.earnings : totalEarnings).toFixed(2)}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: DASH_GREEN }}>+{bookingCount} booking{bookingCount !== 1 ? 's' : ''}</span>
                {bookingCount === 0 && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", fontWeight: 400 }}>· List a spot to start earning</span>}
              </div>
            </div>
            <div style={{ width: "100%", touchAction: "none", flexShrink: 0, marginTop: 12 }}>
              <svg viewBox={`0 0 ${CW} ${CH}`} style={{ width: "100%", display: "block", userSelect: "none" }}
                onPointerDown={onCDown} onPointerMove={onCMove}
                onPointerUp={() => setChartScrubIdx(null)} onPointerLeave={() => setChartScrubIdx(null)}>
                <defs>
                  <linearGradient id="hEarnGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={DASH_GREEN} stopOpacity="0.24"/>
                    <stop offset="90%" stopColor={DASH_GREEN} stopOpacity="0.01"/>
                  </linearGradient>
                </defs>
                {areaPath && <path d={areaPath} fill="url(#hEarnGrad)"/>}
                {linePath && <path d={linePath} fill="none" stroke={DASH_GREEN} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>}
                {labelIdxs.map(i => (
                  <text key={i} x={pts[i]?.x ?? 0} y={CH - 7} textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.22)" fontFamily="DM Sans,sans-serif" fontWeight="600">{pts[i]?.label ?? ''}</text>
                ))}
                {scrubPt && (
                  <>
                    <line x1={scrubPt.x} y1={PT} x2={scrubPt.x} y2={PT + ch} stroke="rgba(255,255,255,0.28)" strokeWidth="1"/>
                    <circle cx={scrubPt.x} cy={scrubPt.y} r="3.5" fill={DASH_GREEN} stroke="#0a1628" strokeWidth="2"/>
                  </>
                )}
              </svg>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 2, padding: "2px 16px 14px" }}>
                {(['D','W','M','Y','ALL'] as const).map(r => (
                  <button key={r} onClick={() => { setEarningsRange(r); setChartScrubIdx(null); }} style={{
                    padding: "5px 13px", borderRadius: 20,
                    background: earningsRange === r ? "rgba(255,255,255,0.14)" : "transparent", border: "none",
                    color: earningsRange === r ? "#fff" : "rgba(255,255,255,0.32)",
                    fontSize: 12, fontWeight: earningsRange === r ? 700 : 400,
                    cursor: "pointer", fontFamily: "'DM Sans',sans-serif", transition: "all 0.15s",
                  }}>{r}</button>
                ))}
              </div>
            </div>
          </>
        );

        // Shared back-button + round icon style
        const backBtn = (onClick: () => void) => (
          <button onClick={onClick} style={{
            width: 38, height: 38, borderRadius: "50%",
            background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.14)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", flexShrink: 0, padding: 0,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
          </button>
        );

        const sheetHandle = (
          <div style={{ display: "flex", justifyContent: "center", paddingTop: 10, paddingBottom: 14 }}>
            <div style={{ width: 34, height: 4, borderRadius: 2, background: "rgba(14,31,64,0.12)" }}/>
          </div>
        );

        return (
          <div key="host-dash" style={{
            position: "absolute", inset: 0, zIndex: 50,
            background: DASH_NAVY, display: "flex", flexDirection: "column",
            fontFamily: "'DM Sans',sans-serif",
          }}>

            {hostDashView === 'earnings' ? (
              // ════════════════════════════════
              // EARNINGS DETAIL VIEW
              // ════════════════════════════════
              <>
                <div style={{ flexShrink: 0, padding: "calc(env(safe-area-inset-top) + 14px) 20px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    {backBtn(() => setHostDashView('main'))}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 21, fontWeight: 800, color: "#fff", letterSpacing: -0.5 }}>Earnings</div>
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.40)", marginTop: 1 }}>Revenue overview · {allTimeCount} booking{allTimeCount !== 1 ? 's' : ''} total</div>
                    </div>
                  </div>
                </div>

                {chartBlock}

                {/* White card — metrics */}
                <div style={{ flex: 1, overflowY: "auto", background: "#F4F6FA", borderRadius: "26px 26px 0 0", WebkitOverflowScrolling: "touch" as any, paddingBottom: "calc(env(safe-area-inset-bottom) + 24px)" }}>
                  {sheetHandle}

                  {/* 2×2 breakdown grid */}
                  <div style={{ padding: "0 16px 14px" }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(14,31,64,0.38)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>Breakdown</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      {([
                        { label: "Today",      value: todayEarn,   dark: false },
                        { label: "This Week",  value: weekEarn,    dark: false },
                        { label: "This Month", value: monthEarn,   dark: false },
                        { label: "All Time",   value: allTimeTotal, dark: true  },
                      ] as const).map(s => (
                        <div key={s.label} style={{ background: s.dark ? DASH_NAVY : "#fff", borderRadius: 14, padding: "14px", border: s.dark ? "none" : "1px solid rgba(14,31,64,0.07)" }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: s.dark ? "rgba(255,255,255,0.40)" : "rgba(14,31,64,0.38)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 }}>{s.label}</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: s.dark ? "#fff" : DASH_NAVY, letterSpacing: -0.8 }}>${s.value.toFixed(2)}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Per booking */}
                  <div style={{ margin: "0 16px 12px", background: "#fff", borderRadius: 14, border: "1px solid rgba(14,31,64,0.07)", padding: "14px 16px" }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(14,31,64,0.38)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>Per Booking</div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontSize: 11, color: "rgba(14,31,64,0.42)", fontWeight: 500, marginBottom: 3 }}>Avg earnings</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: DASH_NAVY, letterSpacing: -1 }}>${avgPerBooking.toFixed(2)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 11, color: "rgba(14,31,64,0.42)", fontWeight: 500, marginBottom: 3 }}>Total bookings</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: DASH_NAVY, letterSpacing: -1 }}>{allTimeCount}</div>
                      </div>
                    </div>
                  </div>

                  {/* By status */}
                  <div style={{ margin: "0 16px", background: "#fff", borderRadius: 14, border: "1px solid rgba(14,31,64,0.07)", overflow: "hidden" }}>
                    <div style={{ padding: "12px 16px 6px" }}>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(14,31,64,0.38)", letterSpacing: 1, textTransform: "uppercase" }}>By Status</div>
                    </div>
                    {([
                      { label: "Confirmed", count: confirmedCount, total: confirmedTotal, dot: DASH_GREEN,  color: "#3a6b0f"  },
                      { label: "Pending",   count: pendingCount,   total: pendingTotal,   dot: "#f59e0b",   color: "#92400e"  },
                      { label: "Denied",    count: allTimeCount - confirmedCount - pendingCount, total: allTimeTotal - confirmedTotal - pendingTotal, dot: "rgba(14,31,64,0.20)", color: "rgba(14,31,64,0.35)" },
                    ]).map((s, i) => (
                      <div key={s.label}>
                        {i > 0 && <div style={{ height: 1, background: "rgba(14,31,64,0.05)", marginLeft: 16 }}/>}
                        <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", gap: 12 }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: s.dot, flexShrink: 0 }}/>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 600, color: DASH_NAVY }}>{s.label}</div>
                            <div style={{ fontSize: 11, color: "rgba(14,31,64,0.38)", marginTop: 1 }}>{s.count} booking{s.count !== 1 ? 's' : ''}</div>
                          </div>
                          <div style={{ fontSize: 15, fontWeight: 800, color: s.color }}>${Math.max(0, s.total).toFixed(2)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              // ════════════════════════════════
              // MAIN DASHBOARD VIEW
              // ════════════════════════════════
              <>
                <div style={{ flexShrink: 0, padding: "calc(env(safe-area-inset-top) + 14px) 20px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    {backBtn(() => setDrawerMode("driver"))}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 21, fontWeight: 800, color: "#fff", letterSpacing: -0.5 }}>Host Dashboard</div>
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.40)", marginTop: 1 }}>
                        {scrubPt ? scrubPt.label : bookingCount > 0 ? `${bookingCount} booking${bookingCount !== 1 ? 's' : ''} · $${totalEarnings.toFixed(2)} earned` : "All caught up"}
                      </div>
                    </div>
                  </div>
                </div>

                {chartBlock}

                {/* White card — action rows */}
                <div style={{ flex: 1, overflowY: "auto", background: "#F4F6FA", borderRadius: "26px 26px 0 0", WebkitOverflowScrolling: "touch" as any, paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)" }}>
                  {sheetHandle}
                  <div style={{ margin: "0 16px", background: "#fff", borderRadius: 16, overflow: "hidden", border: "1px solid rgba(14,31,64,0.07)" }}>
                    {actions.map((a, idx) => (
                      <div key={a.label}>
                        {idx > 0 && <div style={{ height: 1, background: "rgba(14,31,64,0.06)", marginLeft: 58 }}/>}
                        <button onClick={() => a.onPress ? a.onPress() : goTo(a.page!)} style={{
                          display: "flex", alignItems: "center", gap: 14,
                          width: "100%", padding: "13px 16px",
                          background: "transparent", border: "none",
                          cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
                          WebkitTapHighlightColor: "transparent",
                        }}>
                          <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: a.accent ? "rgba(141,214,63,0.15)" : "rgba(14,31,64,0.06)", display: "flex", alignItems: "center", justifyContent: "center", color: a.accent ? "#3a6b0f" : "rgba(14,31,64,0.45)" }}>{a.icon}</div>
                          <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: a.accent ? "#3a6b0f" : DASH_NAVY, letterSpacing: -0.2 }}>{a.label}</div>
                            <div style={{ fontSize: 11, color: "rgba(14,31,64,0.38)", marginTop: 1 }}>{a.sub}</div>
                          </div>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(14,31,64,0.22)" strokeWidth="2.5" strokeLinecap="round"><path d="m9 18 6-6-6-6"/></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* ── LOCATION PROMPT ── */}
      {locPromptOpen && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-end", zIndex: 200 }}>
          <div style={{ width: "100%", background: "#152849", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: "24px 22px calc(env(safe-area-inset-bottom) + 24px)", color: "#fff", fontFamily: "'DM Sans', sans-serif" }}>
            <div style={{ width: 36, height: 4, background: "rgba(255,255,255,0.18)", borderRadius: 2, margin: "0 auto 18px" }} />
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(141,214,63,0.16)", border: "1px solid rgba(141,214,63,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#8DD63F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                </svg>
              </div>
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.4, textAlign: "center", marginBottom: 8 }}>
              Find parking near you
            </div>
            <div style={{ fontSize: 13.5, color: "rgba(255,255,255,0.65)", textAlign: "center", lineHeight: 1.45, marginBottom: 22, padding: "0 4px" }}>
              Share your location so we can show open spots within walking distance and zoom in on your area.
            </div>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
              <button
                onClick={grantLocation}
                title="Share location to find nearby parking"
                style={{
                  width: 56, height: 56,
                  borderRadius: "50%",
                  background: locating ? "rgba(56,189,248,0.22)" : "rgba(255,255,255,0.92)",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  border: locating ? "1.5px solid rgba(56,189,248,0.5)" : "1px solid rgba(14,31,64,0.10)",
                  boxShadow: "0 2px 12px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.7)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                {locating ? (
                  <div style={{ width: 22, height: 22, borderRadius: "50%", border: "2.5px solid rgba(56,189,248,0.25)", borderTopColor: "rgba(56,189,248,0.9)", animation: "spin 0.7s linear infinite" }} />
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0E1F40" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
                    <circle cx="12" cy="12" r="8" strokeOpacity="0.25"/>
                  </svg>
                )}
              </button>
            </div>
            <button
              onClick={skipLocation}
              style={{ width: "100%", padding: "12px", background: "transparent", border: "none", color: "rgba(255,255,255,0.55)", fontFamily: "'DM Sans', sans-serif", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {/* ── PHOTO LIGHTBOX ── */}
      {lightboxIdx !== null && selectedSpot !== null && (() => {
        const spot = spots.find(s => s.id === selectedSpot);
        if (!spot) return null;
        const ALL_GRADIENTS = [
          "linear-gradient(145deg,#1e3a5f 0%,#2d5986 100%)",
          "linear-gradient(145deg,#2d3a2e 0%,#3d5c3f 100%)",
          "linear-gradient(145deg,#3a2a1e 0%,#5c4030 100%)",
          "linear-gradient(145deg,#1e2a3a 0%,#2a3d5c 100%)",
          "linear-gradient(145deg,#3a1e2a 0%,#5c2a3d 100%)",
        ];
        const lbPhotos = spot.photo_urls && spot.photo_urls.length > 0
          ? spot.photo_urls
          : (spot.photo_url ? [spot.photo_url] : []);
        const photoCount = Math.max(lbPhotos.length, 1);
        const grads = Array.from({ length: photoCount }, (_, i) =>
          ALL_GRADIENTS[(idHash(spot.id) + i) % ALL_GRADIENTS.length]
        );
        const idx = Math.max(0, Math.min(lightboxIdx, photoCount - 1));
        return (
          <div
            onClick={() => setLightboxIdx(null)}
            style={{ position: "absolute", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.92)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 16 }}
          >
            <button
              onClick={e => { e.stopPropagation(); setLightboxIdx(null); }}
              style={{ position: "absolute", top: "calc(env(safe-area-inset-top) + 14px)", right: 16, width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.18)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
            <div style={{ width: "100%", maxWidth: 520, aspectRatio: "4/3", borderRadius: 18, background: grads[idx], border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 18px 60px rgba(0,0,0,0.55)", overflow: "hidden", position: "relative" }}>
              {lbPhotos[idx] && (
                <img src={lbPhotos[idx]} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
              )}
              {photoCount > 1 && (
                <div style={{ position: "absolute", bottom: 10, right: 12, fontSize: 12, fontWeight: 700, color: "#fff", background: "rgba(0,0,0,0.5)", borderRadius: 8, padding: "3px 8px" }}>
                  {idx + 1} / {photoCount}
                </div>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 18 }}>
              <button
                onClick={e => { e.stopPropagation(); setLightboxIdx((idx - 1 + photoCount) % photoCount); }}
                style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.18)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", fontWeight: 600, letterSpacing: 0.4 }}>{idx + 1} of {photoCount}</span>
              <button
                onClick={e => { e.stopPropagation(); setLightboxIdx((idx + 1) % photoCount); }}
                style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.18)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
