import path from "node:path";
import { Module } from "node:module";

// Vercel بياخد مخرجات TypeScript (dist) كجذر للـFunction، فالـentry بيبقى app.js في الجذر،
// لكنه بيتتبّع node_modules بمفتاح من جذر الـrepo (backend/node_modules). النتيجة إن
// `require("express")` من /var/task/app.js بيدوّر في /var/task/node_modules ومش بيلاقي حاجة،
// فالموديول كله بيفشل وقت التحميل وكل /api/* بيرجع FUNCTION_INVOCATION_FAILED.
// التصحيح ده بيوسّع بحث require على مسار الـnode_modules الحقيقي — وبيتنفّذ قبل أي import تاني.
type ResolveFilename = (
  request: string,
  parent?: NodeModule,
  isMain?: boolean,
  options?: unknown
) => string;

const moduleWithResolver = Module as unknown as { _resolveFilename: ResolveFilename };
const originalResolve = moduleWithResolver._resolveFilename;

const extraModulePaths = [
  // على Vercel: جذر الـFunction هو /var/task ومعه /var/task/backend/node_modules
  path.join(process.cwd(), "backend", "node_modules"),
  // محليًا: dist/config/resolve-modules.js → backend/node_modules
  path.resolve(__dirname, "..", "..", "node_modules"),
];

moduleWithResolver._resolveFilename = function patchedResolve(
  request,
  parent,
  isMain,
  options
) {
  try {
    return originalResolve.call(this, request, parent, isMain, options);
  } catch (error) {
    const isBareImport = !request.startsWith(".") && !path.isAbsolute(request);
    if (!parent || !isBareImport || (error as { code?: string }).code !== "MODULE_NOT_FOUND") {
      throw error;
    }

    for (const dir of extraModulePaths) {
      const scoped = { ...parent, paths: [dir] } as unknown as NodeModule;
      try {
        return originalResolve.call(this, request, scoped, isMain, options);
      } catch {
        /* جرّب المسار اللي بعده */
      }
    }

    throw error;
  }
};
