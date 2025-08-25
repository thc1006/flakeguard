export declare const config: {
    readonly env: "development" | "production" | "test";
    readonly port: number;
    readonly host: string;
    readonly databaseUrl: string;
    readonly redisUrl: string;
    readonly jwtSecret: string;
    readonly apiKey: string;
    readonly rateLimitMax: number;
    readonly rateLimitWindow: number;
    readonly logLevel: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
    readonly corsOrigin: string;
    readonly policy: {
        readonly warnThreshold: number;
        readonly quarantineThreshold: number;
    };
    readonly features: {
        readonly slackApp: boolean;
        readonly githubWebhooks: boolean;
        readonly quarantineActions: boolean;
    };
    readonly github: {
        readonly appId: number;
        readonly privateKey: string;
        readonly webhookSecret: string;
        readonly clientId: string;
        readonly clientSecret: string;
    };
    readonly slack: {
        signingSecret: string;
        token: string;
        appToken: string | undefined;
        port: number | undefined;
        processBeforeResponse: boolean | undefined;
    } | null;
};
export type Config = typeof config;
export type GitHubConfig = typeof config.github;
export type SlackConfig = NonNullable<typeof config.slack>;
export declare function requireSlackConfig(): SlackConfig;
//# sourceMappingURL=index.d.ts.map