# MediCN Backend

Backend infrastructure for authentication, listings, messaging, and marketplace workflows.

## API Structure

/auth
Authentication routes

/listings
Listing CRUD functionality

/users
User profile management

/messages
Inquiry and communication workflows

## Database Structure

Primary entities include:
- Users
- Listings
- Messages
- Verification Records
- Transactions

## Deployment

Current hosting target:
- Vercel (frontend)
- Railway/Render (backend)

Deployment steps:
1. Push to main branch
2. Verify environment variables
3. Trigger deployment pipeline

## Plain English Explanation

This backend handles:
- user logins
- listing creation
- inquiries between hosts and renters
- verification workflows

## Known Issues

- Stripe integration incomplete
- Mobile optimization ongoing
- Messaging notifications not finalized

# README & Documentation Policy

To maintain continuity, scalability, and long-term maintainability of The MediCN platform, contributors are expected to update relevant documentation whenever major features, workflows, integrations, or architectural changes are introduced.

Documentation is considered part of the development process — not a separate final step.

## Documentation Update Expectations

README files should be updated whenever contributors:
- Add a new major feature
- Modify setup instructions
- Introduce new environment variables
- Change project structure or architecture
- Add integrations or third-party services
- Create new workflows or APIs
- Modify deployment procedures
- Add significant dependencies
- Introduce known limitations or technical considerations

## Required Documentation Areas

Contributors should document:
- Feature purpose and functionality
- Setup and installation changes
- Environment variables
- API usage
- Folder structure updates
- Architectural decisions
- Deployment considerations
- Known issues or limitations
- Future improvement considerations

## Plain English Requirement

Major systems and workflows should include a brief “plain English” explanation so non-technical stakeholders can understand the purpose and functionality of the system.

## Pull Request Expectation

If a major feature is added, the associated pull request should include:
- Summary of changes
- Setup/update instructions if applicable
- Documentation updates completed
- Known issues or future considerations

## Long-Term Goal

The goal of this policy is to:
- Reduce dependency on individual contributors
- Improve onboarding for future developers
- Preserve institutional knowledge
- Improve scalability and continuity
- Maintain organized startup operations

Major features that are not reasonably documented may be considered incomplete until documentation is updated.

## Architecture Decision Notes

Significant technical decisions should include:
- what decision was made
- why it was chosen
- alternatives considered
- expected tradeoffs
