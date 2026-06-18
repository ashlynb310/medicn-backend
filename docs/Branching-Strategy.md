# MediCN Week 1

## Branching Strategy

### Branch Types

#### `main`

Stable branch. This branch should only contain code that has been reviewed, tested, and is safe to deploy.

- All changes must go through a pull request.
- Pull requests into `main` must be reviewed and approved.
- Only the repository owner has permission to merge into `main`.
- No direct pushes to `main`.

#### `dev`

Integration branch for development. Feature branches should merge into the `dev` branch first to test changes before sending pull requests to `main`.

- All changes must go through a pull request.
- Pull requests into `dev` should be reviewed.
- No direct pushes to `dev`.

#### `feature/<task-name>`

Feature branches are used for new features.

- Create feature branches from the latest `dev` branch.
- Open a pull request back into `dev` when ready.
- Document changes in this branch.
- Delete the branch after it is tested and merged.

#### `fix/<fix-name>`

Fix branches are used for fixing existing bugs.

- Create fix branches from the latest `dev` branch.
- Open a pull request back into `dev` when ready.
- Document changes and testing results in this branch.
- Delete the branch after it is merged.

#### `docs/<name>`

Document all changes and updates on the `dev` branch.

- Create docs branches from the latest `dev` branch.
- Write the documents.
- Open a pull request back into `dev` when ready.
- Delete the branch after it is merged.

## Recommended Branch Workflow

1. Select the latest `dev` branch.
2. Create a working branch `feature/*` or `fix/*` from the `dev` branch.
3. Push changes to the branch.
4. Open a pull request into the `dev` branch.
5. Review and merge into the `dev` branch.
6. Test integrated changes in the `dev` branch and open a pull request to the `main` branch.
7. Create a docs branch `docs/*` from the `dev` branch.
8. Push changes to the branch.
9. Open a pull request into the `dev` branch.
10. Review and merge into the `dev` branch.
11. Repo owner reviews and merges into the `main` branch.
12. Delete the `feature/*` or `fix/*` branch.
