import api from "@/lib/api";
import type { Paginated, ReviewEntity, ReviewRequest } from "@/types";

export async function listReviews(params: {
  entity?: ReviewEntity;
  status?: "PENDING_REVIEW" | "APPROVED" | "REJECTED";
  submittedBy?: number;
  page?: number;
  pageSize?: number;
} = {}) {
  const { data } = await api.get<Paginated<ReviewRequest>>("/review", { params });
  return data;
}

export async function getReview(id: number) {
  const { data } = await api.get<ReviewRequest>(`/review/${id}`);
  return data;
}

export async function updateReview(id: number, data: Record<string, unknown>) {
  const { data: res } = await api.put<ReviewRequest>(`/review/${id}`, { data });
  return res;
}

export async function approveReview(id: number) {
  const { data } = await api.post<{ review: ReviewRequest; record: unknown; updated: boolean; sent?: boolean | null; sendError?: string | null }>(
    `/review/${id}/approve`,
  );
  return data;
}

export async function rejectReview(id: number, reason: string) {
  const { data } = await api.post<ReviewRequest>(`/review/${id}/reject`, { reason });
  return data;
}

/** اعتماد كل سجلات المجموعة في طلب واحد. */
export interface BulkApproveResult {
  approved: number;
  skipped: number;
  total: number;
  failed?: Array<{ id: number; message: string }>;
  sendFailed?: Array<{ id: number; message: string }>;
}

export async function bulkApproveReviews(ids: number[]) {
  const { data } = await api.post<BulkApproveResult>("/review/bulk-approve", { ids });
  return data;
}

/** حذف طلب معلّق وسجله المرتبط لو لسه مااترسلش. */
export async function deleteReview(id: number) {
  const { data } = await api.delete<{ message: string }>(`/review/${id}`);
  return data;
}
