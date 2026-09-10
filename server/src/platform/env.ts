// Reading the environment ONCE into a typed object, so one boot error names every problem
// rather than the first one.
//
// This replaced the framework's config loader. It is deliberately four small functions: the
// environment this app reads is five values long, and anything that grows past that belongs
// in the console, where an operator can change it without a deploy.

/** @internal One variable: where to read it from, and how to turn text into a value. */
interface Spec<T> {
    name: string;
    parse(raw: string | undefined): { ok: true; value: T } | { ok: false; problem: string };

    /** Keeps the value out of any dump of the config object. */
    secret?: boolean;
}

export function str(
    name: string,
    options: { default?: string; secret?: boolean } = {}
): Spec<string> {
    return {
        name,
        secret: options.secret,
        parse: (raw) => {
            const value = raw ?? options.default;
            return value === undefined
                ? { ok: false, problem: 'is required' }
                : { ok: true, value };
        }
    };
}

export function num(name: string, options: { default?: number } = {}): Spec<number> {
    return {
        name,
        parse: (raw) => {
            if (raw === undefined || raw === '') {
                return options.default === undefined
                    ? { ok: false, problem: 'is required' }
                    : { ok: true, value: options.default };
            }
            const value = Number(raw);
            return Number.isFinite(value)
                ? { ok: true, value }
                : { ok: false, problem: `is not a number (got ${raw})` };
        }
    };
}

export function bool(name: string, options: { default: boolean }): Spec<boolean> {
    return {
        name,
        parse: (raw) => {
            if (raw === undefined || raw === '') {
                return { ok: true, value: options.default };
            }
            if (['1', 'true', 'yes', 'on'].includes(raw.toLowerCase())) {
                return { ok: true, value: true };
            }
            if (['0', 'false', 'no', 'off'].includes(raw.toLowerCase())) {
                return { ok: true, value: false };
            }
            return { ok: false, problem: `is not a boolean (got ${raw})` };
        }
    };
}

export function oneOf<T extends string>(
    name: string,
    allowed: readonly T[],
    options: { default?: T } = {}
): Spec<T> {
    return {
        name,
        parse: (raw) => {
            const value = raw ?? options.default;
            if (value === undefined) {
                return { ok: false, problem: 'is required' };
            }
            return allowed.includes(value as T)
                ? { ok: true, value: value as T }
                : { ok: false, problem: `must be one of ${allowed.join(', ')} (got ${value})` };
        }
    };
}

type Loaded<S> = { [K in keyof S]: S[K] extends Spec<infer T> ? T : never };

/**
 * Reads every variable and reports EVERY problem at once. A loader that throws on the first
 * missing value turns configuring a deployment into a guessing game played one restart at a
 * time.
 */
export function loadConfig<S extends Record<string, Spec<unknown>>>(spec: S): Loaded<S> {
    const result: Record<string, unknown> = {};
    const problems: string[] = [];

    for (const [key, variable] of Object.entries(spec)) {
        const parsed = variable.parse(process.env[variable.name]);
        if (parsed.ok) {
            result[key] = parsed.value;
        } else {
            problems.push(`  ${variable.name} ${parsed.problem}`);
        }
    }

    if (problems.length > 0) {
        throw new Error(`Configuration is not usable:\n${problems.join('\n')}`);
    }

    return result as Loaded<S>;
}
