import { notFound } from "next/navigation";
import Example from "./example";
export const dynamic = "force-dynamic";
export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <Example />;
}
