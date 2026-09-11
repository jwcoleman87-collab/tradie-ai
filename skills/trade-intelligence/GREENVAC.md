---
name: GreenVac operating intelligence
version: 1.0.0
managed: true
applies: greenvac | hydro excavation | hydrovac
---

# Use

Apply these rules when the confirmed business profile is GreenVac or hydro excavation.
They are owner-lab operating knowledge, not another customer's data.
Do not apply GreenVac prices to an unrelated trade workspace.
If a fact is missing, ask once or escalate Ask James. Do not invent.

# 1 Quote limit
Jobs whose estimated total exceeds AUD 4,500 still need an explicit owner Accept on the proposal. Never issue them quietly.

# 2 Travel bands (from Braidwood / ACT–Southern NSW)
0–20 km: included.
20–50 km: AUD 85.
50–100 km: AUD 165.
100+ km: AUD 165 + AUD 2.20 per km after 100.
Kingston, Fyshwick, Queanbeyan, Canberra inner: included unless the owner says otherwise.

# 3 Minimum charge
AUD 650 inc GST. Applies even if on-site time would price below that.

# 4 Hourly
AUD 185 inc GST on site.

# 5 After-hours
1.5× hourly after 18:00 weekdays and all weekend hours.

# 6 Cancellation
Inside 24 hours of the start: 50% of the minimum (AUD 325). Outside 24 hours: no fee.

# 7 Variations
Quoted scope is binding. Depth, width, hours, spoil, access or live-service change after a quote is a VARIATION.
Use draft.save (invoice/note) plus record.create (job) for the change. Never silently reprice the original quote.

# 8 Booking
calendar.create only with exact start, end, UTC offset and IANA zone.
Owner Accept books it. Moving a job is a new calendar.create for the new slot, plus a job record describing the move. Do not claim the old slot is released until Accept.

# 9 Pre-start
DBYD / asset plans before excavation. Near known electrical: hydro/pothole only. No mechanical within 300 mm of known assets.

# 10 Machine operation
Trailer hydrovac. Typical residential trench 300–600 mm. Do not claim a job is within capacity if access, spoil or depth is unknown.

# 11 Training
Operator must be inducted on the unit before live-asset work. If training status is unknown, say so; do not certify competence.

# 12 Job records
record.create kind=job for owner-supplied facts: customer, suburb, spec, hours, depth, live services. draft.save for AI-estimated quotes.

# 13 Spoil
Assumed left on site unless dump is quoted.

# 14 Machine capacity
Do not bid work that needs a truck-mounted vac or confined-space ticket unless the owner confirms that plant and ticket exist.

# 15 Wet weather
Hydrovac can run in rain; lightning and flooded pits stop work. Do not invent a weather call.

# 16 Payment
Quotes are inc GST. Do not invent deposits unless the owner has a recorded deposit rule.

# 17 Customer qualification
Before a first visit, need: suburb, access, what is being exposed, known services, spoil plan, hours or a size.

# 18 Ask James
Insurance, electrical isolation authority, industrial awards, or anything not in these rules: escalation safety_review or missing_information. Never guess a legal position.

# Conversation pattern
Owner: "John called. Friday instead, 600 deep."
If a John job and quote exist in workspace records: propose (1) calendar.create for Friday with duration including +1 h for 600 mm around power, (2) record.create job spec update, (3) draft.save variation invoice = new labour − original quote. Reply that the original quote no longer covers it. Wait for Accept.
