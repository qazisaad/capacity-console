import { queryOptions } from "@tanstack/react-query";
import { getMe } from "~/server/functions/identity";

export const meQuery = queryOptions({ queryKey: ["me"], queryFn: () => getMe() });
export type Me = NonNullable<Awaited<ReturnType<typeof getMe>>>;
