# MediCN Frontend

Frontend application for The MediCN healthcare housing marketplace.

## Tech Stack
- Next.js
- React
- Tailwind CSS
- TypeScript

## Local Development Setup

1. Clone the repository

git clone <repo-url>

2. Install dependencies

npm install

3. Create environment variables

Create a `.env.local` file using the example below.

4. Run the development server

npm run dev

## Environment Variables

NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_STRIPE_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=

Do NOT commit sensitive keys to GitHub.

## Frontend Architecture

/pages
Main routing pages

/components
Reusable UI components

/features
Marketplace-specific features

/lib
Utilities and helper functions

/styles
Global styles and Tailwind configuration

## Documentation Standards

- All major features should include explanatory comments
- New workflows should be documented
- Significant architectural decisions should be added to the Decision Log

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

## What's Been Done
- Created wireframes of the pages that will be remodeled/changed from the sample MVP MediCN website.
- Added shadcn/ui to the project for easier component creation.
- Created several components under /src/components directory.
- Acquired placeholder and social media images under /public directory.
- Redesigned and made the MediCN home page in nextjs.

## Frontend Architecture
- Next.js app configuration: TypeScript, ESLint, React Compiler, Tailwind CSS, /src directory, App Router, import alias "@", and AGENTS.md.

| Tool / Dependency | Version |
|-------------------|---------|
| Next.js           | 16.2.7  |
| ESLint            | 9.39.4  |
| React Compiler    | 1.0.0   |
| Tailwind CSS      | 4.3.0   |
| Npm               | 11.16.0 |

ShadCN UI Info
- Radix vs Base: Base
- Present: Nova
- Imported components from Shadcn UI will be placed in the src/components/ui directory.
- Installation of Shadcn UI will add utils.ts to /lib directory, and components.json to the project.

ShadCN UI Detailed Info
| Project          |                     |
|------------------|---------------------|
| framework        | Next.js (next-app)  |
| frameworkVersion | 16.2.7              |
| srcDirectory     | Yes                 |
| rsc              | Yes                 |
| typescript       | Yes                 |
| tailwindVersion  | v4                  |
| tailwindConfig   | -                   |
| tailwindCss      | src/app/globals.css |
| importAlias      | @                   |

| Configuration |           |
|---------------|-----------|
| style         | base-nova |
| base          | base      |
| rsc           | Yes       |
| typescript    | Yes       |
| iconLibrary   | lucide    |
| rtl           | No        |
| menuColor     | default   |
| menuAccent    | subtle    |
| importAlias   | @         |

| Preset      |                                          |
|-------------|------------------------------------------|
| code        | b2fA                                     |
| version     | b                                        |
| style       | nova                                     |
| baseColor   | neutral                                  |
| theme       | neutral                                  |
| chartColor  | neutral                                  |
| iconLibrary | lucide                                   |
| font        | geist*                                   |
| fontHeading | inherit                                  |
| radius      | default                                  |
| menuAccent  | subtle                                   |
| menuColor   | default                                  |
| url         | https://ui.shadcn.com/create?preset=b2fA |

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

