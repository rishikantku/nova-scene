import { redirect } from "next/navigation";

export default function CreateRedirect() {
  // The Dashboard ("/") is now our creation hub where you select between "One-Time Video" and "Story Mode".
  // So clicking "Create" in the sidebar should just take you to the Dashboard.
  redirect("/");
}
