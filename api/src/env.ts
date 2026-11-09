export const env = (name: string, fallback = ""): string => Deno.env.get(name) ?? fallback;
