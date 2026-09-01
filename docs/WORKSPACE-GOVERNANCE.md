# Tradie AI Workspace and Records Governance Standard

**Status:** Approved product baseline

**Owner:** Tradie AI product owner

**Review cycle:** Annual, and whenever legislation, integrations or record types change

**Applies to:** Workspaces, conversations, files, proposed actions, business records, support cases, connections and audit receipts

## 1. Purpose

Tradie AI separates current work from historical evidence without silently deleting business information. This standard follows the lifecycle principles of [ISO 15489-1:2016](https://www.iso.org/standard/62542.html): records must retain their business context and remain authentic, reliable, intact and usable over time.

This is a product and operating standard, not legal advice. GreenVac should confirm final retention periods with its accountant, employment adviser and insurer.

## 2. Workspace structure

Use one workspace for each business or legally distinct operating context. A workspace owns its own conversations, files, records, approvals, audit evidence and external connections. Connections must never be inherited by another workspace.

The initial structure is:

| Workspace       | Type                | Purpose                                                           |
| --------------- | ------------------- | ----------------------------------------------------------------- |
| GreenVac        | Business operations | Live GreenVac work and GreenVac-owned connections                 |
| Sandbox — James | Sandbox / learning  | Integration testing, demonstrations and personal test connections |

Additional brands or customers should receive separate workspaces when their records, staff permissions, connected accounts or legal responsibilities differ.

## 3. Lifecycle

1. **Active** — current work may be created, discussed, approved and executed.
2. **Closed/history** — a completed, denied or expired action; or a resolved support case. The system files it automatically and it remains readable.
3. **Archived** — inactive workspace, conversation or record. It is read-only, excluded from normal working lists and can be restored. Archiving is not deletion.
4. **Legal hold** — disposal is suspended regardless of the normal retention period. A hold remains until an authorised owner releases it.
5. **Disposition review** — after the retention period, an authorised owner decides whether to retain, export, de-identify or destroy the record. Tradie AI does not yet perform automatic destruction.

Archiving must be blocked while an AI request, approval or external action is still live. Every archive and restore operation creates an audit receipt.

## 4. Treatment of each workspace section

| Section         | Active view                                                            | Archive/history treatment                                                                                                                 |
| --------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Conversations   | Current conversations only                                             | Archive the complete conversation; messages and linked files remain together and read-only                                                |
| Files           | Files belonging to the selected conversation                           | Follow the conversation lifecycle; do not orphan or silently relocate file bytes                                                          |
| Actions         | Waiting approval, approved, executing or failed work needing attention | Completed, denied and expired actions move automatically to Action History; approval and execution receipts remain immutable              |
| Records         | Current business memory                                                | Records can be archived and restored individually; retention classification travels with the record                                       |
| Ask James cases | Open cases                                                             | Resolved cases move to history with their Case ID, solution and outcome                                                                   |
| Connections     | Only usable by an active workspace                                     | Remain bound to their original workspace; disconnect before final account closure and revoke upstream access where appropriate            |
| Audit           | Recent operational receipts                                            | Never treated as ordinary content and never editable through the product; export and long-term retention are operational responsibilities |

## 5. Retention schedule

The following schedule is a conservative product baseline for an Australian company. A longer legal, contractual, insurance or litigation requirement always wins.

| Record class                                     | Baseline           | Trigger and notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Financial records, invoices and expenses         | 7 years            | From completion of the relevant transaction. ASIC states that companies must keep financial records for at least seven years. The ATO commonly requires business records for at least five years, so the seven-year company baseline is used here. See [ASIC company record keeping](https://www.asic.gov.au/for-business-and-companies/companies/company-building-blocks/company-record-keeping) and the [ATO record-keeping overview](https://www.ato.gov.au/api/public/content/0-53cc7a8e-0668-4c9d-95d7-eb841eb09c04). |
| Employee time, pay and entitlement records       | 7 years            | From the date of the entry or relevant employment event. [Fair Work requires time and wage records to be kept for seven years](https://www.fairwork.gov.au/pay-and-wages/paying-wages/record-keeping).                                                                                                                                                                                                                                                                                                                     |
| Jobs, assets, maintenance and safety evidence    | 7 years            | From job closure, asset disposal or supersession; extend where contract, warranty, safety, insurance or incident requirements apply.                                                                                                                                                                                                                                                                                                                                                                                       |
| Approved advertising, website and social records | 7 years            | From publication, campaign closure or supersession when the record is evidence of a business decision or spend. Working drafts that never became evidence may use the conversation rule.                                                                                                                                                                                                                                                                                                                                   |
| General conversations and unapproved drafts      | 2 years            | From conversation closure, unless linked to a job, customer, approval, dispute, safety event or formal record; linked material inherits the longer class.                                                                                                                                                                                                                                                                                                                                                                  |
| Customer and other personal information          | Need-based review  | Retain only while required for the business purpose or by law. APP 11 requires reasonable steps to destroy or de-identify personal information that is no longer needed; see the [OAIC APP 11 guidance](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-11-app-11-security-of-personal-information).                                                                                                                                                        |
| Approval, execution and audit receipts           | 7 years            | From the recorded event, or longer when attached to a record with a longer retention period. Preserve integrity and workspace context.                                                                                                                                                                                                                                                                                                                                                                                     |
| Legal hold material                              | Until hold release | No disposition while litigation, investigation, insurance, complaint, audit or regulator need remains active.                                                                                                                                                                                                                                                                                                                                                                                                              |

## 6. Operating procedure

- Staff work only in an active business workspace. Testing belongs in a sandbox.
- Close or deny outstanding proposals before archiving a conversation or workspace.
- Review inactive conversations quarterly and archive them with their linked files.
- Review archived records and personal information at least annually.
- Before disposition, check retention class, legal hold, open disputes, tax/employment requirements, contracts and insurance needs.
- Record who authorised disposition, what was affected, the rule used and when it occurred.
- Backups must be encrypted, access-controlled and tested. Backup copies follow the same retention intent and expire through controlled rotation; they are not a permanent shadow archive.
- Restore tests should be performed at least annually for business-critical records.

## 7. Product controls implemented

- Multiple owner workspaces, classified as business or sandbox.
- Reversible workspace, conversation and business-record archive states.
- Archived containers are read-only until explicitly restored.
- Live AI runs and approval/execution work prevent archiving.
- Completed actions and resolved support cases are separated from active work.
- Archive/restore events are written to immutable audit history.
- Financial and personal-information retention classifications are assigned to existing business records.
- No hard-delete control is exposed in the workspace.

## 8. Controlled follow-up work

Before production-wide automated disposition, add owner-approved exports, legal-hold administration, retention-due reporting, verified deletion/de-identification jobs, backup-expiry evidence and an audit export. Until those controls exist, expired records must be reviewed manually and must not be represented as destroyed.
