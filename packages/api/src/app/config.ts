export type AppConfig = {
  env: string;
  region: string;
};

export function readConfig(): AppConfig {
  return {
    env: process.env.NODE_ENV ?? 'development',
    region: process.env.APP_REGION ?? 'eu-central',
  };
}
