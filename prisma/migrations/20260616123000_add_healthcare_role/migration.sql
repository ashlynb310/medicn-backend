CREATE TYPE "HealthcareRole" AS ENUM (
  'medical_student',
  'nursing_student',
  'nurse',
  'resident_physician',
  'physician',
  'other'
);

ALTER TABLE "User" ADD COLUMN "healthcareRole" "HealthcareRole";
