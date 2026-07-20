import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  HealthcareAffiliationType,
  HealthcareDecisionReasonCode,
  HealthcareEvidenceCategory,
  HealthcareRole
} from "@prisma/client";
import { CreateHealthcareEvidenceUploadDto } from "../src/healthcare/dto/create-healthcare-evidence-upload.dto";
import { CreateHealthcareVerificationDto } from "../src/healthcare/dto/create-healthcare-verification.dto";
import { DecideHealthcareVerificationDto } from "../src/healthcare/dto/decide-healthcare-verification.dto";

describe("healthcare verification DTO boundaries", () => {
  it("accepts only bounded allowlisted claim fields", async () => {
    const valid = plainToInstance(CreateHealthcareVerificationDto, {
      claimedRole: HealthcareRole.medical_student,
      claimedAffiliationName: " Medical School ",
      claimedAffiliationType: HealthcareAffiliationType.medical_school,
      evidenceCategory: HealthcareEvidenceCategory.student
    });
    expect(await validate(valid)).toHaveLength(0);
    expect(valid.claimedAffiliationName).toBe("Medical School");

    const invalid = plainToInstance(CreateHealthcareVerificationDto, {
      ...valid,
      claimedAffiliationName: "x".repeat(201)
    });
    expect(await validate(invalid)).not.toHaveLength(0);
  });

  it("rejects PDF upload intents", async () => {
    const upload = plainToInstance(CreateHealthcareEvidenceUploadDto, {
      fileName: "credential.pdf",
      contentType: "application/pdf"
    });
    expect(await validate(upload)).not.toHaveLength(0);
  });

  it("bounds the private decision note at 1000 characters", async () => {
    const valid = plainToInstance(DecideHealthcareVerificationDto, {
      status: "rejected",
      reasonCode: HealthcareDecisionReasonCode.evidence_unreadable,
      note: "x".repeat(1000)
    });
    expect(await validate(valid)).toHaveLength(0);

    const invalid = plainToInstance(DecideHealthcareVerificationDto, {
      ...valid,
      note: "x".repeat(1001)
    });
    expect(await validate(invalid)).not.toHaveLength(0);
  });
});
