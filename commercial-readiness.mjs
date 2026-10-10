// Public information only. No credentials, mutations, or live checkout switch.
export const commercialPolicy={
 version:'draft-20261010',status:'draft',realPaymentsEnabled:false,
 products:{sitebuilder:{startCredits:20},offertetool:{startCredits:50}},
 creditDefinition:'One successfully completed customer AI request. Failed requests return the reserved credit.',
 ordinaryCalculationsConsumeCredits:false,
 creditsExpireAfterDays:365,
 support:{monthlyMinutes:10,requestsPerMonth:1,scope:'Product support; no custom development or campaign management.'},
 topups:[{units:25,priceExVat:9},{units:100,priceExVat:29}],
 topupCheckoutEnabled:false,
 monthlyService:{cancelAtPeriodEnd:true,automaticDebitEnabled:false},
 prerequisites:['separate-amcinova-live-key','terms-and-prices-reviewed','credit-metering-enabled','live-purchase-migration','customer-tools-verified','service-renewal-and-cancellation-tested']
};
export function commercialReadiness(env={}){
 return {policy:commercialPolicy,realPaymentsEnabled:false,
  liveKeyConfigured:/^live_[A-Za-z0-9]{10,}$/.test((env.AMCINOVA_MOLLIE_LIVE_API_KEY||'').trim()),
  meteringConfigured:env.CUSTOMER_AI_CREDITS_ENABLED==='true',
  message:'Live checkout is not registered. Completing a test payment never activates a purchase.'};
}
