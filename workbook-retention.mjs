// Six calendar months in UTC, clamping the date to the last day of the target month.
export function sixMonthsAfter(value){
 const date=new Date(value);if(!Number.isFinite(date.getTime()))throw new Error('Invalid retention start');
 const day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+6);
 const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();date.setUTCDate(Math.min(day,last));return date.toISOString();
}
export function retentionView(row,now=Date.now(),{followUpAuthorized=false}={}){
 const start=row.created_at,due=sixMonthsAfter(start),active=row.metadata?.followUpStatus==='active'&&followUpAuthorized;
 const reviewAt=active?(row.metadata.followUpReviewAt||sixMonthsAfter(row.metadata.followUpStartedAt||start)):null;
 return {startsAt:start,eligibleAt:due,followUpStatus:active?'active':'none',followUpStartedAt:row.metadata?.followUpStartedAt||null,followUpReviewAt:reviewAt,eligible:!active&&Date.parse(due)<=now,reviewOverdue:active&&Date.parse(reviewAt)<=now};
}
