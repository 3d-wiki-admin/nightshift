import { VercelProvisioner } from './vercel.mjs';
import { SupabaseProvisioner } from './supabase.mjs';
import { RailwayProvisioner } from './railway.mjs';
import { UpstashRedisProvisioner } from './redis.mjs';

export { BaseProvisioner, ProvisionerError, cliExists } from './interface.mjs';
export { VercelProvisioner, SupabaseProvisioner, RailwayProvisioner, UpstashRedisProvisioner };

const REGISTRY = {
  vercel: VercelProvisioner,
  supabase: SupabaseProvisioner,
  railway: RailwayProvisioner,
  redis: UpstashRedisProvisioner
};

export function makeProvisioner(service, opts) {
  const Cls = REGISTRY[service];
  if (!Cls) throw new Error(`Unknown provisioner service: '${service}'. Available: ${Object.keys(REGISTRY).join(', ')}`);
  return new Cls(opts);
}

export function listServices() {
  return Object.keys(REGISTRY);
}
