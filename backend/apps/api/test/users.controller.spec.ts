import type { AuthService } from "../src/auth/auth.service";
import { UsersController } from "../src/users/users.controller";
import type { UsersService } from "../src/users/users.service";

describe("UsersController", () => {
  it("gets a public user profile without requiring an authorization header", async () => {
    const authService = {
      extractBearerToken: jest.fn()
    };
    const usersService = {
      getPublicUser: jest.fn().mockResolvedValue({
        id: "user_host_1",
        displayName: "Maya H"
      })
    };
    const controller = new UsersController(
      authService as unknown as AuthService,
      usersService as unknown as UsersService
    );

    await expect(controller.getPublicUser("user_host_1")).resolves.toEqual({
      id: "user_host_1",
      displayName: "Maya H"
    });
    expect(usersService.getPublicUser).toHaveBeenCalledWith("user_host_1");
    expect(authService.extractBearerToken).not.toHaveBeenCalled();
  });
});
