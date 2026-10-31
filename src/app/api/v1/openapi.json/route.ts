import { openApiDocument } from "@/lib/api/docs";

export async function GET(req: Request) {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  const base = configured || new URL(req.url).origin;
  return Response.json(openApiDocument(`${base}/api/v1`));
}
