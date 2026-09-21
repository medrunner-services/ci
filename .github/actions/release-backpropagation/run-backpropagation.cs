#!/usr/bin/env -S dotnet --
#:property TargetFramework=net10.0
#:property Nullable=enable
#:property ManagePackageVersionsCentrally=false
#:property RestorePackagesWithLockFile=false
#:package CliWrap@3.9.0

using System.Globalization;
using System.Text.Json;
using CliWrap;
using CliWrap.Buffered;

/*
 * Summary:
 *   Creates, approves, and optionally auto-merges a release backpropagation pull request.
 *
 * Remarks:
 *   The script is intended to run from the release-backpropagation composite action.
 *   It uses CliWrap for GitHub CLI command execution.
 *   It uses PR_AUTOMATION_PAT only for review approval.
 */

return await RunAsync();

static async Task<int> RunAsync()
{
    var workspace = RequiredEnvironment("GITHUB_WORKSPACE");
    var newVersion = RequiredEnvironment("ACTION_INPUT_NEW_VERSION");
    var releaseRefName = RequiredEnvironment("ACTION_INPUT_RELEASE_REF_NAME");
    var defaultBranch = RequiredEnvironment("ACTION_INPUT_DEFAULT_BRANCH");
    var labels = SplitLines(EnvironmentOrDefault("ACTION_INPUT_LABELS", "ci\nautomated")).ToArray();
    var autoMerge = ParseBoolean("ACTION_INPUT_AUTO_MERGE", defaultValue: true);
    var approve = ParseBoolean("ACTION_INPUT_APPROVE", defaultValue: true);
    var mergeMethod = EnvironmentOrDefault("ACTION_INPUT_MERGE_METHOD", "merge");

    if (mergeMethod is not ("merge" or "squash" or "rebase"))
    {
        Console.Error.WriteLine("merge-method must be merge, squash, or rebase.");
        return 2;
    }

    var pr = await CreateOrFindPullRequestAsync(workspace, newVersion, releaseRefName, defaultBranch, labels);
    if (pr is null)
    {
        return 1;
    }

    if (approve)
    {
        var automationToken = Environment.GetEnvironmentVariable("PR_AUTOMATION_PAT");
        if (string.IsNullOrWhiteSpace(automationToken))
        {
            Console.Error.WriteLine("PR_AUTOMATION_PAT is required when approve is true.");
            return 2;
        }

        var approveResult = await RunGhAsync(
            ["pr", "review", pr.Url, "--approve"],
            workspace,
            tokenOverride: automationToken,
            allowFailure: true);

        if (approveResult.ExitCode != 0)
        {
            return approveResult.ExitCode;
        }
    }

    if (autoMerge)
    {
        var mergeResult = await RunGhAsync(
            ["pr", "merge", pr.Url, $"--{mergeMethod}", "--auto"],
            workspace,
            tokenOverride: null,
            allowFailure: true);

        if (mergeResult.ExitCode != 0)
        {
            return mergeResult.ExitCode;
        }
    }

    WriteOutput("pr-url", pr.Url);
    WriteOutput("pr-number", pr.Number.ToString(CultureInfo.InvariantCulture));

    await AppendStepSummaryAsync($"""
        ## Release backpropagation

        - Version: {newVersion}
        - Source branch: {releaseRefName}
        - Target branch: {defaultBranch}
        - Pull request: {pr.Url}
        - Auto-merge: {autoMerge}

        """);

    return 0;
}

static async Task<PullRequest?> CreateOrFindPullRequestAsync(
    string workspace,
    string newVersion,
    string releaseRefName,
    string defaultBranch,
    IReadOnlyList<string> labels)
{
    var args = new List<string>
    {
        "pr",
        "new",
        "--base",
        defaultBranch,
        "--head",
        releaseRefName,
        "--title",
        $"Backpropagate release version to default branch: {newVersion}",
        "--body",
        "This is an automated post-release action."
    };

    foreach (var label in labels)
    {
        args.Add("--label");
        args.Add(label);
    }

    var createResult = await RunGhAsync(args, workspace, tokenOverride: null, allowFailure: true);
    if (createResult.ExitCode == 0)
    {
        var url = createResult.StandardOutput.Trim().Split('\n', StringSplitOptions.RemoveEmptyEntries).LastOrDefault()?.Trim();
        if (!string.IsNullOrWhiteSpace(url))
        {
            return await ReadPullRequestAsync(workspace, url);
        }
    }

    Console.Error.WriteLine("Creating PR failed; checking whether a PR already exists for the release branch.");
    var existingResult = await RunGhAsync(
        ["pr", "view", releaseRefName, "--json", "url,number"],
        workspace,
        tokenOverride: null,
        allowFailure: true);

    if (existingResult.ExitCode != 0)
    {
        Console.Error.Write(createResult.StandardError);
        return null;
    }

    return ParsePullRequest(existingResult.StandardOutput);
}

static async Task<PullRequest?> ReadPullRequestAsync(string workspace, string prUrl)
{
    var result = await RunGhAsync(
        ["pr", "view", prUrl, "--json", "url,number"],
        workspace,
        tokenOverride: null,
        allowFailure: true);

    return result.ExitCode == 0 ? ParsePullRequest(result.StandardOutput) : null;
}

static PullRequest? ParsePullRequest(string json)
{
    using var document = JsonDocument.Parse(json);
    var root = document.RootElement;
    if (!root.TryGetProperty("url", out var urlElement) || !root.TryGetProperty("number", out var numberElement))
    {
        return null;
    }

    return new PullRequest(urlElement.GetString() ?? string.Empty, numberElement.GetInt32());
}

static async Task<CommandRunResult> RunGhAsync(
    IReadOnlyList<string> arguments,
    string workingDirectory,
    string? tokenOverride,
    bool allowFailure)
{
    Console.WriteLine(RenderCommand("gh", arguments));

    var command = Cli.Wrap("gh")
        .WithArguments(arguments)
        .WithWorkingDirectory(workingDirectory)
        .WithValidation(CommandResultValidation.None);

    if (!string.IsNullOrWhiteSpace(tokenOverride))
    {
        command = command.WithEnvironmentVariables(new Dictionary<string, string?>
        {
            ["GH_TOKEN"] = tokenOverride
        });
    }

    var result = await command.ExecuteBufferedAsync();
    Console.Write(result.StandardOutput);
    Console.Error.Write(result.StandardError);

    if (!allowFailure && result.ExitCode != 0)
    {
        Console.Error.WriteLine($"gh failed with exit code {result.ExitCode}.");
    }

    return new CommandRunResult(result.ExitCode, result.StandardOutput, result.StandardError);
}

static IEnumerable<string> SplitLines(string value)
{
    return value.ReplaceLineEndings("\n")
        .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .Where(line => !line.StartsWith('#'));
}

static string RequiredEnvironment(string name)
{
    var value = Environment.GetEnvironmentVariable(name);
    if (string.IsNullOrWhiteSpace(value))
    {
        throw new InvalidOperationException($"Required environment variable is missing: {name}");
    }

    return value;
}

static string EnvironmentOrDefault(string name, string defaultValue)
{
    var value = Environment.GetEnvironmentVariable(name);
    return string.IsNullOrEmpty(value) ? defaultValue : value;
}

static bool ParseBoolean(string name, bool defaultValue)
{
    var rawValue = Environment.GetEnvironmentVariable(name);
    if (string.IsNullOrWhiteSpace(rawValue))
    {
        return defaultValue;
    }

    return rawValue.ToLowerInvariant() switch
    {
        "true" => true,
        "false" => false,
        _ => throw new InvalidOperationException($"{name} must be true or false.")
    };
}

static string RenderCommand(string executable, IEnumerable<string> arguments)
{
    return string.Join(' ', new[] { executable }.Concat(arguments).Select(QuoteForLog));
}

static string QuoteForLog(string value)
{
    return value.Any(char.IsWhiteSpace)
        ? "\"" + value.Replace("\"", "\\\"", StringComparison.Ordinal) + "\""
        : value;
}

static void WriteOutput(string name, string value)
{
    var outputPath = Environment.GetEnvironmentVariable("GITHUB_OUTPUT");
    if (string.IsNullOrWhiteSpace(outputPath))
    {
        return;
    }

    File.AppendAllText(outputPath, $"{name}={value}{Environment.NewLine}");
}

static async Task AppendStepSummaryAsync(string markdown)
{
    var summaryPath = Environment.GetEnvironmentVariable("GITHUB_STEP_SUMMARY");
    if (string.IsNullOrWhiteSpace(summaryPath))
    {
        return;
    }

    await File.AppendAllTextAsync(summaryPath, markdown);
}

sealed record PullRequest(string Url, int Number);

sealed record CommandRunResult(int ExitCode, string StandardOutput, string StandardError);
