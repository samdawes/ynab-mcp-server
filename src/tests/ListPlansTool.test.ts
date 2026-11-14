import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import * as ynab from 'ynab';
import * as ListPlansTool from '../tools/ListPlansTool';

vi.mock('ynab');

describe('ListPlansTool', () => {
  let mockApi: {
    plans: {
      getPlans: Mock;
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockApi = {
      plans: {
        getPlans: vi.fn(),
      },
    };

    (ynab.API as any).mockImplementation(() => mockApi);

    process.env.YNAB_API_TOKEN = 'test-token';
    delete process.env.YNAB_LOCK_PLAN;
    delete process.env.YNAB_PLAN_ID;
    delete process.env.YNAB_BUDGET_ID;
  });

  afterEach(() => {
    delete process.env.YNAB_LOCK_PLAN;
    delete process.env.YNAB_PLAN_ID;
    delete process.env.YNAB_BUDGET_ID;
  });

  describe('execute', () => {
    const mockBudgetsData = [
      {
        id: 'budget-1',
        name: 'My Personal Budget',
        last_modified_on: '2023-01-01T00:00:00Z',
        first_month: '2023-01-01',
        last_month: '2023-12-01',
        date_format: {
          format: 'MM/DD/YYYY',
        },
        currency_format: {
          iso_code: 'USD',
          example_format: '123,456.78',
          decimal_digits: 2,
          decimal_separator: '.',
          symbol_first: true,
          group_separator: ',',
          currency_symbol: '$',
          display_symbol: true,
        },
      },
      {
        id: 'budget-2',
        name: 'Family Budget',
        last_modified_on: '2023-01-02T00:00:00Z',
        first_month: '2023-01-01',
        last_month: '2023-12-01',
        date_format: {
          format: 'DD/MM/YYYY',
        },
        currency_format: {
          iso_code: 'EUR',
          example_format: '123.456,78',
          decimal_digits: 2,
          decimal_separator: ',',
          symbol_first: false,
          group_separator: '.',
          currency_symbol: '€',
          display_symbol: true,
        },
      },
      {
        id: 'budget-3',
        name: 'Business Budget',
        last_modified_on: '2023-01-03T00:00:00Z',
        first_month: '2023-01-01',
        last_month: '2023-12-01',
        date_format: {
          format: 'YYYY-MM-DD',
        },
        currency_format: {
          iso_code: 'GBP',
          example_format: '£123,456.78',
          decimal_digits: 2,
          decimal_separator: '.',
          symbol_first: true,
          group_separator: ',',
          currency_symbol: '£',
          display_symbol: true,
        },
      },
    ];

    it('should successfully list all budgets', async () => {
      mockApi.plans.getPlans.mockResolvedValue({
        data: { plans: mockBudgetsData },
      });

      const result = await ListPlansTool.execute({}, mockApi as any);

      expect(mockApi.plans.getPlans).toHaveBeenCalledWith();

      const expectedResult = {
        content: [{
          type: "text",
          text: JSON.stringify([
            { id: 'budget-1', name: 'My Personal Budget' },
            { id: 'budget-2', name: 'Family Budget' },
            { id: 'budget-3', name: 'Business Budget' },
          ], null, 2)
        }]
      };

      expect(result).toEqual(expectedResult);
    });

    it('should handle empty budget list', async () => {
      mockApi.plans.getPlans.mockResolvedValue({
        data: { plans: [] },
      });

      const result = await ListPlansTool.execute({}, mockApi as any);

      expect(mockApi.plans.getPlans).toHaveBeenCalledWith();

      const expectedResult = {
        content: [{
          type: "text",
          text: JSON.stringify([], null, 2)
        }]
      };

      expect(result).toEqual(expectedResult);
    });

    it('should handle single budget', async () => {
      const singleBudget = [mockBudgetsData[0]];

      mockApi.plans.getPlans.mockResolvedValue({
        data: { plans: singleBudget },
      });

      const result = await ListPlansTool.execute({}, mockApi as any);

      const expectedResult = {
        content: [{
          type: "text",
          text: JSON.stringify([
            { id: 'budget-1', name: 'My Personal Budget' },
          ], null, 2)
        }]
      };

      expect(result).toEqual(expectedResult);
    });

    it('should return error message when YNAB API token is not set', async () => {
      delete process.env.YNAB_API_TOKEN;

      const result = await ListPlansTool.execute({}, mockApi as any);

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text)).toEqual({
        success: false,
        error: "YNAB API Token is not set",
      });
      expect(mockApi.plans.getPlans).not.toHaveBeenCalled();
    });

    it('should return error message when YNAB API token is empty string', async () => {
      process.env.YNAB_API_TOKEN = '';

      const result = await ListPlansTool.execute({}, mockApi as any);

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text)).toEqual({
        success: false,
        error: "YNAB API Token is not set",
      });
      expect(mockApi.plans.getPlans).not.toHaveBeenCalled();
    });

    it('should handle API error', async () => {
      const apiError = new Error('API Error: Unauthorized');
      mockApi.plans.getPlans.mockRejectedValue(apiError);

      const result = await ListPlansTool.execute({}, mockApi as any);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(false);
      expect(response.error).toContain('API Error: Unauthorized');
    });

    it('should handle budgets with special characters in names', async () => {
      const specialBudgets = [
        {
          id: 'budget-special-1',
          name: 'Budget with "Quotes" & Symbols!',
          last_modified_on: '2023-01-01T00:00:00Z',
          first_month: '2023-01-01',
          last_month: '2023-12-01',
          date_format: { format: 'MM/DD/YYYY' },
          currency_format: {
            iso_code: 'USD',
            example_format: '123,456.78',
            decimal_digits: 2,
            decimal_separator: '.',
            symbol_first: true,
            group_separator: ',',
            currency_symbol: '$',
            display_symbol: true,
          },
        },
        {
          id: 'budget-special-2',
          name: 'émojis 🎯 & ünîcødé',
          last_modified_on: '2023-01-02T00:00:00Z',
          first_month: '2023-01-01',
          last_month: '2023-12-01',
          date_format: { format: 'DD/MM/YYYY' },
          currency_format: {
            iso_code: 'EUR',
            example_format: '123.456,78',
            decimal_digits: 2,
            decimal_separator: ',',
            symbol_first: false,
            group_separator: '.',
            currency_symbol: '€',
            display_symbol: true,
          },
        },
      ];

      mockApi.plans.getPlans.mockResolvedValue({
        data: { plans: specialBudgets },
      });

      const result = await ListPlansTool.execute({}, mockApi as any);

      const expectedResult = {
        content: [{
          type: "text",
          text: JSON.stringify([
            { id: 'budget-special-1', name: 'Budget with "Quotes" & Symbols!' },
            { id: 'budget-special-2', name: 'émojis 🎯 & ünîcødé' },
          ], null, 2)
        }]
      };

      expect(result).toEqual(expectedResult);
    });
  });

  describe('with YNAB_LOCK_PLAN', () => {
    const plans = [
      { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'My Budget' },
      { id: 'bbbbbbbb-0000-4000-8000-000000000002', name: '2026' },
      { id: 'cccccccc-0000-4000-8000-000000000003', name: "Samuel's Plan" },
    ];

    beforeEach(() => {
      process.env.YNAB_LOCK_PLAN = 'true';
      mockApi.plans.getPlans.mockResolvedValue({ data: { plans } });
    });

    it('lists only the configured plan', async () => {
      process.env.YNAB_PLAN_ID = 'BBBBBBBB-0000-4000-8000-000000000002';

      const result = await ListPlansTool.execute({}, mockApi as any);

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0].text)).toEqual([
        { id: 'bbbbbbbb-0000-4000-8000-000000000002', name: '2026' },
      ]);
    });

    it('names no plan when the token cannot see the configured one', async () => {
      process.env.YNAB_PLAN_ID = 'dddddddd-0000-4000-8000-000000000004';

      const result = await ListPlansTool.execute({}, mockApi as any);

      expect(result.isError).toBe(true);
      const { error } = JSON.parse(result.content[0].text);
      expect(error).toContain('cannot access that plan');
      for (const plan of plans) {
        expect(result.content[0].text).not.toContain(plan.id);
        expect(result.content[0].text).not.toContain(plan.name);
      }
    });

    it('lists nothing when no plan is configured', async () => {
      const result = await ListPlansTool.execute({}, mockApi as any);

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error).toContain('YNAB_PLAN_ID is not set');
      for (const plan of plans) expect(result.content[0].text).not.toContain(plan.name);
    });
  });

  describe('tool configuration', () => {
    it('should have correct name and description', () => {
      expect(ListPlansTool.name).toBe('ynab_list_plans');
      expect(ListPlansTool.description).toBe('Lists all available plans from YNAB API');
    });

    it('should have empty input schema', () => {
      expect(ListPlansTool.inputSchema).toEqual({});
    });
  });
});