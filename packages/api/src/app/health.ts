export type HealthSnapshot = {
  status: 'ok';
  modules: string[];
};

export function healthSnapshot(): HealthSnapshot {
  return {
    status: 'ok',
    modules: [
      'tracking-core',
      'hunter-core',
      'token-control-plane',
      'autonomy-orchestrator',
      'self-heal-controller',
      'alert-router',
      'ml-platform',
    ],
  };
}
