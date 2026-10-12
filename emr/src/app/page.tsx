import { redirect } from "next/navigation";

// Signed-out visitors never get here: the proxy sends them to /login first.
export default function Home() {
  redirect("/trips");
}
