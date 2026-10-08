"use client";

import { useQuery } from "@tanstack/react-query";
import { api, qs } from "./api";

export interface Company { id: string; legalName: string; tradeName: string | null; cnpj: string; active: boolean }
export interface Establishment { id: string; companyId: string; name: string; code: string | null; cnpj: string | null; active: boolean; company?: { tradeName: string | null; legalName: string } }
export interface Department { id: string; companyId: string; establishmentId: string; name: string; code: string | null; active: boolean; establishment?: { name: string } }
export interface Job { id: string; companyId: string; name: string; cbo: string | null; active: boolean; _count?: { employees: number; epiRequirements: number } }
export interface Variant { id: string; productId: string; sku: string; size: string | null; color: string | null; ean: string | null; active: boolean }
export interface EpiProduct {
  id: string;
  internalCode: string;
  description: string;
  category: string;
  manufacturer: string | null;
  replacementDays: number | null;
  unit: string;
  reusable: boolean;
  requiresReturn: boolean;
  unitCost: string | null;
  status: string;
  guidance: Record<string, string | null>;
  variants: Variant[];
  cas: Array<{ caNumber: string; isCurrent: boolean; linkedAt: string }>;
}
export interface Warehouse { id: string; companyId: string; establishmentId: string; name: string; code: string; kind: string; locations: Array<{ id: string; code: string; isDefault: boolean }>; establishment?: { name: string } }
export interface Reason { id: string; code: string; name: string; requiresJustification: boolean; active: boolean; sortOrder: number }
export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }

const long = { staleTime: 5 * 60_000 };

export const useCompanies = () => useQuery({ queryKey: ["companies"], queryFn: () => api.get<Company[]>("/companies"), ...long });
export const useEstablishments = (companyId?: string) =>
  useQuery({ queryKey: ["establishments", companyId ?? ""], queryFn: () => api.get<Establishment[]>(`/establishments${qs({ companyId })}`), ...long });
export const useDepartments = (companyId?: string) =>
  useQuery({ queryKey: ["departments", companyId ?? ""], queryFn: () => api.get<Department[]>(`/departments${qs({ companyId })}`), ...long });
export const useJobs = (companyId?: string) => useQuery({ queryKey: ["jobs", companyId ?? ""], queryFn: () => api.get<Job[]>(`/jobs${qs({ companyId })}`), ...long });
export const useWarehouses = () => useQuery({ queryKey: ["warehouses"], queryFn: () => api.get<Warehouse[]>("/stock/warehouses"), ...long });
export const useReasons = () => useQuery({ queryKey: ["reasons"], queryFn: () => api.get<Reason[]>("/delivery-reasons"), ...long });
export const useEpis = (q = "") =>
  useQuery({ queryKey: ["epis", q], queryFn: () => api.get<Paged<EpiProduct>>(`/epis${qs({ q, status: "ACTIVE", pageSize: 100 })}`), staleTime: 60_000 });

export function companyName(c?: { tradeName: string | null; legalName: string } | null): string {
  return c ? (c.tradeName ?? c.legalName) : "—";
}

export function variantLabel(v: Variant): string {
  return [v.size && `Tam. ${v.size}`, v.color].filter(Boolean).join(" · ") || "Único";
}
