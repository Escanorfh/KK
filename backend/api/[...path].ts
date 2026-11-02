import type { IncomingMessage, ServerResponse } from "node:http";
import app from "../src/app";

// Vercel ما يشغّلش Express كعملية دائمة: كل ملف تحت api/ بيُحوَّل لـ Function واحدة.
// المسار الكامل (/api/…) بيوصل كما هو لراوترات Express، فـ `app` callable ويستقبل (req, res).
export default function handler(req: IncomingMessage, res: ServerResponse): unknown {
  return (app as unknown as (req: IncomingMessage, res: ServerResponse) => unknown)(req, res);
}
