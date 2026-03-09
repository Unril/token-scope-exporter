# Token Export Test

Inline code: `const x = 42;`

## TypeScript

```typescript
interface User {
  id: number;
  name: string;
}

function greet(user: User): string {
  return `Hello, ${user.name}!`;
}
```

## Python

```python
def factorial(n: int) -> int:
    if n <= 1:
        return 1
    return n * factorial(n - 1)
```

## JSON

```json
{
  "name": "token-scope-exporter",
  "version": "0.0.1"
}
```

## Kotlin

```kotlin
data class User(val id: Long, val name: String)

fun greet(user: User): String = "Hello, ${user.name}!"
```

## Java

```java
public record User(long id, String name) {}

public static String greet(User user) {
    return "Hello, " + user.name() + "!";
}
```

## JavaScript

```javascript
function greet(user) {
  return `Hello, ${user.name}!`;
}

const admins = users.filter(u => u.role === 'admin');
```

## Plain text

No code here, just a paragraph with **bold** and *italic* text.

## Mixed

Some text before.

```kotlin
fun main() {
    println("Hello Kotlin")
}
```

Some text after with a [test link](https://example.com).
