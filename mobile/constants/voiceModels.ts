// Voice agent model options for the settings picker
export const VOICE_AGENT_MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', description: 'Fast & efficient' },
  { id: 'claude-sonnet-4-5-20250514', label: 'Sonnet 4.5', description: 'Balanced performance' }
] as const;

export type VoiceAgentModelId = typeof VOICE_AGENT_MODELS[number]['id'];

export const DEFAULT_VOICE_AGENT_MODEL: VoiceAgentModelId = VOICE_AGENT_MODELS[0].id;
