# Contributing to Stockwise

Thank you for your interest in contributing to Stockwise! We welcome contributions from the community and are excited to work with you.

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md) to ensure a welcoming environment for all contributors.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/stockwise.git`
3. Create a branch for your feature or bugfix: `git checkout -b feature/your-feature-name`
4. Make your changes
5. Commit your changes with a descriptive commit message
6. Push to your fork: `git push origin feature/your-feature-name`
7. Create a pull request

## Development Setup

See the [Development Guide](DEVELOPMENT.md) for detailed instructions on setting up your development environment.

## How to Contribute

### Reporting Bugs

Before reporting a bug, please check the existing issues to see if it has already been reported.

When reporting a bug, please include:

1. A clear and descriptive title
2. Steps to reproduce the issue
3. Expected behavior
4. Actual behavior
5. Screenshots if applicable
6. Environment information (browser, OS, etc.)

### Suggesting Enhancements

We welcome suggestions for new features or improvements to existing functionality. When suggesting an enhancement:

1. Check existing issues to avoid duplicates
2. Provide a clear and descriptive title
3. Describe the proposed enhancement in detail
4. Explain why this enhancement would be useful
5. If possible, provide examples of how the feature would work

### Code Contributions

#### Pull Request Process

1. Ensure your code follows our coding standards
2. Write tests for new functionality
3. Update documentation as needed
4. Ensure all tests pass
5. Submit a pull request with a clear description of your changes

#### Code Style

- Follow the existing code style in the project
- Use TypeScript for type safety
- Write clear, self-documenting code
- Use meaningful variable and function names
- Keep functions small and focused
- Comment complex logic

#### Testing

- Write unit tests for new functionality
- Ensure existing tests continue to pass
- Test your changes manually
- Include end-to-end tests for critical user flows

#### Documentation

- Update README files if you change functionality
- Add JSDoc comments for new functions and components
- Update relevant documentation files

### Git Commit Guidelines

We follow conventional commit messages to maintain a clean history:

```
type(scope): description

body (optional)

footer (optional)
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `chore`: Maintenance tasks
- `docs`: Documentation changes
- `style`: Code style changes
- `refactor`: Code refactoring
- `test`: Test-related changes
- `perf`: Performance improvements

Examples:
```
feat(auth): add password reset functionality

fix(dashboard): resolve chart rendering issue

docs(readme): update installation instructions

refactor(components): simplify button component logic
```

## Development Workflow

### Branch Naming

Use descriptive branch names:

- `feature/feature-name` for new features
- `bugfix/issue-description` for bug fixes
- `docs/documentation-topic` for documentation changes
- `refactor/component-name` for refactoring work

### Pull Request Guidelines

1. Create focused pull requests that address a single issue or feature
2. Include a clear description of the changes
3. Reference any related issues
4. Request review from appropriate team members
5. Address feedback promptly
6. Keep pull requests up to date with the base branch

### Code Review Process

All pull requests must be reviewed before merging:

1. At least one team member must approve the PR
2. All automated checks must pass
3. Feedback should be addressed before merging
4. PRs should be small and focused

## Coding Standards

### TypeScript

- Use strict TypeScript with no implicit any
- Define interfaces for complex objects
- Use enums for constants and status values
- Leverage TypeScript's type system for better code reliability

### React

- Use functional components with hooks
- Extract reusable logic into custom hooks
- Favor composition over inheritance
- Use TypeScript interfaces for props validation

### Styling

- Use Tailwind CSS for styling
- Follow existing class naming conventions
- Ensure responsive design
- Maintain accessibility standards

### Error Handling

- Handle errors gracefully
- Provide user-friendly error messages
- Log errors appropriately
- Use try/catch blocks for asynchronous operations

## Testing Standards

### Unit Tests

- Write tests for new components and functions
- Aim for high test coverage (80%+ for critical code)
- Test edge cases and error conditions
- Use descriptive test names

### Integration Tests

- Test API integrations
- Test component interactions
- Mock external dependencies appropriately

### End-to-End Tests

- Test critical user workflows
- Cover authentication flows
- Test cross-browser compatibility

## Documentation Standards

### README Updates

Update README files when:
- Adding new features
- Changing installation process
- Modifying configuration options
- Updating dependencies

### Inline Documentation

- Use JSDoc for functions and components
- Comment complex logic
- Document public APIs
- Keep comments up to date

### User Documentation

- Update user guides for feature changes
- Add screenshots for UI changes
- Document breaking changes

## Community

### Communication

- Be respectful and professional
- Provide constructive feedback
- Help others in the community
- Share knowledge and best practices

### Recognition

Contributors will be recognized in:
- Release notes
- Contributor list
- Community acknowledgments

## License

By contributing to Stockwise, you agree that your contributions will be licensed under the MIT License.

## Questions?

If you have any questions about contributing, please:
1. Check the existing documentation
2. Open an issue for discussion
3. Contact the maintainers

Thank you for contributing to Stockwise!