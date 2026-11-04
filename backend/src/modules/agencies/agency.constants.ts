export const AGENCY_STATUSES = ['pending', 'active', 'suspended', 'rejected'] as const
export type AgencyStatus = (typeof AGENCY_STATUSES)[number]

export const TEAM_SIZES = ['1-5', '6-15', '16-50', '51-200', '200+'] as const

// Subscriptions are a placeholder: stored and editable by platform admins, not enforced or billed yet.
export const PLANS = ['trial', 'starter', 'growth', 'scale', 'enterprise'] as const
export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'cancelled'] as const
export const TRIAL_DAYS = 14

export const AGENCY_TYPES = ['creative', 'social_media', 'digital_marketing', 'branding', 'content', 'performance', 'pr', 'full_service', 'freelancer', 'other'] as const
