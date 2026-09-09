import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "@/components/intertext/workspace";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <Workspace />;
}
