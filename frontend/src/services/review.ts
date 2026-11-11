import api from "@/lib/api";
import type { Paginated, ReviewRequest } from "@/types";

export async function listReviews(params: {
  entity?: "dailylog" | "maintenance";
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
  const { data } = await api.post<{ review: ReviewRequest; record: unknown; updated: boolean }>(
    `/review/${id}/approve`,
  );
  return data;
}

export async function rejectReview(id: number, reason: string) {
  const { data } = await api.post<ReviewRequest>(`/review/${id}/reject`, { reason });
  return data;
}
