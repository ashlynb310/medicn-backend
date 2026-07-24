import { BadRequestException } from "@nestjs/common";
import { ApiExceptionFilter } from "../src/common/api-exception.filter";

describe("ApiExceptionFilter", () => {
  it("preserves a structured validation error when Nest supplies a string error label", () => {
    const status = jest.fn();
    const json = jest.fn();
    status.mockReturnValue({ json });
    const response = { status };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response
      })
    };
    const filter = new ApiExceptionFilter();

    filter.catch(
      new BadRequestException({
        statusCode: 400,
        message: ["title must be longer than or equal to 3 characters"],
        error: "Bad Request"
      }),
      host as never
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      data: null,
      meta: {},
      error: {
        code: "VALIDATION_ERROR",
        message: "The request could not be completed.",
        details: {
          statusCode: 400,
          message: ["title must be longer than or equal to 3 characters"],
          error: "Bad Request"
        }
      }
    });
  });
});
