# Lovable Design System Analysis

A comprehensive design system analysis for replicating Lovable's visual identity in an iOS light theme app.

---

## Table of Contents
1. [Brand Overview](#brand-overview)
2. [Color System](#color-system)
3. [Typography](#typography)
4. [Icons](#icons)
5. [UI Components](#ui-components)
6. [Spacing & Layout](#spacing--layout)
7. [iOS Light Theme Adaptation](#ios-light-theme-adaptation)

---

## Brand Overview

**Brand Identity:** Lovable is an AI-powered app builder with a warm, modern, and approachable aesthetic. The brand combines technical sophistication with creative warmth through its signature coral/orange gradient and clean typography.

**Logo:** Heart-shaped icon in coral/orange gradient tones, representing the "Lovable" brand name.

**Visual Style:**
- Dark mode primary (website)
- Warm gradient accents (blue → cyan → coral/orange)
- Clean, minimal UI with generous whitespace
- Rounded corners throughout
- Soft shadows for depth

---

## Color System

### Core Colors (Dark Theme - Original)

| Token | HSL | Hex | RGB | Usage |
|-------|-----|-----|-----|-------|
| `--background` | 0 0% 11% | `#1C1C1C` | rgb(28, 28, 28) | Page background |
| `--foreground` | 45 40% 98% | `#FCFBF8` | rgb(252, 251, 248) | Primary text |
| `--card` | 0 0% 5% | `#0D0D0D` | rgb(13, 13, 13) | Card backgrounds |
| `--card-foreground` | 45 40% 98% | `#FCFBF8` | rgb(252, 251, 248) | Card text |
| `--primary` | 45 40% 98% | `#FCFBF8` | rgb(252, 251, 248) | Primary buttons |
| `--primary-foreground` | 0 0% 11% | `#1C1C1C` | rgb(28, 28, 28) | Primary button text |
| `--secondary` | 60 3% 15% | `#272725` | rgb(39, 39, 37) | Secondary elements |
| `--secondary-foreground` | 45 40% 98% | `#FCFBF8` | rgb(252, 251, 248) | Secondary text |
| `--muted` | 60 3% 15% | `#272725` | rgb(39, 39, 37) | Muted backgrounds |
| `--muted-foreground` | 40 9% 75% | `#C5C1BA` | rgb(197, 193, 186) | Muted text |
| `--accent` | 217 33% 22% | `#263047` | rgb(38, 48, 71) | Accent backgrounds |
| `--accent-foreground` | 217 100% 72% | `#70A5FF` | rgb(112, 165, 255) | Accent text |
| `--border` | 60 3% 15% | `#40403F` | rgb(64, 64, 63) | Borders |
| `--input` | 60 1% 25% | `#40403F` | rgb(64, 64, 63) | Input borders |
| `--ring` | 47 10% 83% | `#D8D6CF` | rgb(216, 214, 207) | Focus rings |

### Brand Accent Colors

| Token | HSL | Hex | Usage |
|-------|-----|-----|-------|
| `--brand-tiger-primary` | 14 93% 40% | `#C53307` | Primary coral/orange |
| `--brand-tiger-foreground` | 30 100% 83% | `#FFD4A8` | Light coral |
| `--brand-saffron-primary` | 20 94% 37% | `#B74106` | Deep orange |
| `--brand-saffron-foreground` | 41 100% 77% | `#FFDA8A` | Light gold |
| `--brand-bubblegum-primary` | 308 77% 40% | `#B517A0` | Magenta/pink |
| `--brand-bubblegum-foreground` | 302 100% 90% | `#FFCCFD` | Light pink |
| `--brand-twilight-primary` | 251 60% 51% | `#5337CD` | Purple |
| `--brand-twilight-foreground` | 235 100% 87% | `#BDC2FF` | Light purple |
| `--brand-sapphire-primary` | 217 75% 49% | `#1F6AD9` | Blue |
| `--brand-sapphire-foreground` | 209 100% 85% | `#B3DAFF` | Light blue |
| `--brand-ocean-primary` | 225 88% 53% | `#1855E8` | Deep blue |
| `--brand-scarlet-primary` | 0 93% 54% | `#F21B1B` | Red |
| `--brand-flamingo-primary` | 335 100% 36% | `#B8005E` | Deep pink |

### Semantic Colors

| Token | HSL | Hex | Usage |
|-------|-----|-----|-------|
| `--destructive` | 0 33% 20% | `#442222` | Error backgrounds |
| `--destructive-primary` | 0 95% 42% | `#D10808` | Error/danger |
| `--success` | 142 37% 17% | `#1B3D2A` | Success backgrounds |

### Hero Gradient

The signature Lovable gradient is a radial gradient background image:
- **Top:** Dark blue/teal tones
- **Middle:** Cyan/turquoise transition
- **Bottom:** Warm coral/orange glow
- **File:** `gradient-optimized.webp`

**Approximate gradient colors:**
- Top: `#1a1a2e` (dark blue-black)
- Mid-top: `#16213e` (deep blue)
- Middle: `#0f3460` → `#00b4d8` (blue to cyan)
- Bottom: `#ff6b35` → `#f7931e` (coral to orange)

---

## Typography

### Font Family

**Primary Font:** `CameraPlainVariable` (Variable font)
- Fallback: `"CameraPlainVariable Fallback"`, system-ui, sans-serif

### Type Scale

| Element | Size | Weight | Line Height | Letter Spacing |
|---------|------|--------|-------------|----------------|
| H1 (Hero) | 48px | 480 | 48px (1.0) | normal |
| H2 | 24px | 480 | 32px | normal |
| H3 | 18px | 480 | 27px (1.5) | normal |
| Body | 16px | 400 | 24px (1.5) | normal |
| Body Large | 20px | 400 | 25px | normal |
| Button | 14px | 480 | - | normal |
| Caption/Small | 12px | 400 | 18px | normal |
| Nav | 16px | 400 | 24px | normal |

### Font Weights

| Weight | Value | Usage |
|--------|-------|-------|
| Regular | 400 | Body text, descriptions |
| Medium | 480 | Headings, buttons, emphasis |

### iOS Font Mapping

For iOS, use SF Pro as the system font equivalent:

| Lovable | iOS Equivalent |
|---------|----------------|
| CameraPlainVariable 400 | SF Pro Regular |
| CameraPlainVariable 480 | SF Pro Medium |

---

## Icons

### Icon Library

Lovable uses **Lucide Icons** (React-based, similar to Feather Icons)

### Icon Sizing

| Size | Dimensions | Usage |
|------|------------|-------|
| XS | 12px × 12px | Inline, badges |
| SM | 16px × 16px | Buttons, lists |
| MD | 20px × 20px | Navigation, actions |
| LG | 24px × 24px | Headers, primary actions |
| XL | 36px × 36px | Hero, feature icons |

### Icon Styling

- **Color:** Inherits from parent (`currentColor`)
- **Default fill:** `rgb(252, 251, 248)` (foreground)
- **Muted:** `rgba(252, 251, 248, 0.8)`
- **Stroke width:** 1.5px - 2px
- **Style:** Outline/stroke-based (not filled)

### Common Icons Used

- Navigation: ChevronDown, ChevronRight, Menu, X
- Actions: Plus, Attach (Paperclip), Send, Chat
- Media: Play, Volume, Image
- UI: Check, Info, AlertCircle, Settings
- Brand: Heart (custom logo)

---

## UI Components

### Buttons

#### Primary Button
```
Background: #FCFBF8 (rgb(252, 251, 248))
Text: #1C1C1C (rgb(28, 28, 28))
Border Radius: 6px
Padding: 8px 16px
Font Size: 14px
Font Weight: 480
Border: none
```

#### Secondary Button
```
Background: #272725 (rgb(39, 39, 37))
Text: #FCFBF8 (rgb(252, 251, 248))
Border: 1px solid #40403F (rgb(64, 64, 63))
Border Radius: 6px
Padding: 8px 16px
Font Size: 14px
Font Weight: 480
```

#### Ghost/Transparent Button
```
Background: transparent
Text: #FCFBF8
Border: none
Padding: 8px
```

#### Pill Button (Tags/Badges)
```
Background: #2B2A47 (rgb(43, 42, 71))
Text: varies
Border Radius: 9999px (full rounded)
Padding: 2px 12px
Font Size: 12px
```

### Cards

#### Standard Card
```
Background: #1C1C1C (rgb(28, 28, 28))
Border: 1px solid #40403F (rgb(64, 64, 63))
Border Radius: 16px
Padding: 20px
Box Shadow: 0 10px 15px -3px rgba(0,0,0,0.1),
            0 4px 6px -4px rgba(0,0,0,0.1)
```

#### Dark Card (Input container)
```
Background: #0D0D0D (rgb(13, 13, 13))
Border Radius: 12px
Padding: 16px
```

### Input Fields

#### Text Input
```
Background: transparent
Text: #FCFBF8
Border: none (container has border)
Border Radius: 6px
Padding: 8px
Font Size: 16px
Placeholder: #C5C1BA (muted-foreground)
```

#### Search/Chat Input Container
```
Background: #0D0D0D
Border Radius: 12px
Padding: 16px
```

### Toggle/Switch

```
Background (off): #40403F
Background (on): #FCFBF8
Border Radius: 9999px (pill)
Width: 44px
Height: 24px
Thumb: 20px circle
```

### Badges

#### "New" Badge
```
Background: #2B2A47 (purple-tinted dark)
Text: #BDC2FF (light purple)
Border Radius: 9999px
Padding: 2px 8px
Font Size: 11px
```

### Dropdown/Select

```
Background: #1C1C1C
Border: 1px solid #40403F
Border Radius: 6px
Padding: 8px 12px
Text: #FCFBF8
```

---

## Spacing & Layout

### Spacing Scale

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Tight spacing, icon gaps |
| sm | 8px | Button padding, small gaps |
| md | 16px | Card padding, section gaps |
| lg | 20px | Card padding (large) |
| xl | 24px | Section spacing |
| 2xl | 32px | Large section gaps |
| 3xl | 48px | Page section margins |

### Border Radius Scale

| Token | Value | Usage |
|-------|-------|-------|
| sm | 4px | Small elements |
| md | 6px | Buttons, inputs, badges |
| lg | 12px | Input containers |
| xl | 16px | Cards |
| full | 9999px | Pills, toggles, avatars |

### Layout Grid

- **Max content width:** ~1280px
- **Container padding:** 16px (mobile) / 24px (desktop)
- **Card grid gap:** 16px - 24px
- **4-column grid** for pricing cards (desktop)

### Shadows

#### Card Shadow (Elevated)
```css
box-shadow:
  0 10px 15px -3px rgba(0, 0, 0, 0.1),
  0 4px 6px -4px rgba(0, 0, 0, 0.1);
```

#### Subtle Shadow
```css
box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
```

#### Brand Glow (Logo/Accent)
```css
box-shadow:
  rgba(217, 119, 87, 0.627) 0px 0px 13px 0px inset,
  rgba(217, 119, 87, 0.427) 0px 0px 23px 0px inset,
  rgba(217, 119, 87, 0.16) 0px 0px 33px 0px inset;
```

---

## iOS Light Theme Adaptation

### Color Mapping (Dark → Light)

| Dark Theme | Light Theme (iOS) | Hex |
|------------|-------------------|-----|
| Background `#1C1C1C` | Background | `#FFFFFF` |
| Foreground `#FCFBF8` | Primary Text | `#1C1C1C` |
| Card `#0D0D0D` | Card Background | `#F5F5F5` |
| Secondary `#272725` | Secondary | `#E8E8E8` |
| Muted `#272725` | Muted Background | `#F0F0F0` |
| Muted-foreground `#C5C1BA` | Secondary Text | `#666666` |
| Border `#40403F` | Border | `#E0E0E0` |

### Recommended iOS Light Palette

```swift
// Primary Colors
static let background = Color(hex: "FFFFFF")
static let foreground = Color(hex: "1C1C1C")
static let cardBackground = Color(hex: "F8F8F8")
static let cardForeground = Color(hex: "1C1C1C")

// Secondary Colors
static let secondary = Color(hex: "F0F0F0")
static let secondaryForeground = Color(hex: "1C1C1C")
static let muted = Color(hex: "F5F5F5")
static let mutedForeground = Color(hex: "888888")

// Borders & Inputs
static let border = Color(hex: "E5E5E5")
static let inputBorder = Color(hex: "D0D0D0")
static let ring = Color(hex: "1C1C1C").opacity(0.1)

// Brand Accents (Keep same)
static let brandTiger = Color(hex: "C53307")      // Coral
static let brandSaffron = Color(hex: "B74106")    // Orange
static let brandSapphire = Color(hex: "1F6AD9")   // Blue
static let brandTwilight = Color(hex: "5337CD")   // Purple
static let brandBubblegum = Color(hex: "B517A0")  // Pink

// Semantic
static let destructive = Color(hex: "D10808")
static let success = Color(hex: "22C55E")
```

### iOS Component Specifications

#### Buttons (SwiftUI)

```swift
// Primary Button
Button("Get Started") { }
    .font(.system(size: 14, weight: .medium))
    .foregroundColor(Color(hex: "FFFFFF"))
    .padding(.horizontal, 16)
    .padding(.vertical, 8)
    .background(Color(hex: "1C1C1C"))
    .cornerRadius(6)

// Secondary Button
Button("Log in") { }
    .font(.system(size: 14, weight: .medium))
    .foregroundColor(Color(hex: "1C1C1C"))
    .padding(.horizontal, 16)
    .padding(.vertical, 8)
    .background(Color(hex: "F0F0F0"))
    .overlay(
        RoundedRectangle(cornerRadius: 6)
            .stroke(Color(hex: "E0E0E0"), lineWidth: 1)
    )
    .cornerRadius(6)
```

#### Cards (SwiftUI)

```swift
VStack {
    // Card content
}
.padding(20)
.background(Color(hex: "FFFFFF"))
.cornerRadius(16)
.overlay(
    RoundedRectangle(cornerRadius: 16)
        .stroke(Color(hex: "E5E5E5"), lineWidth: 1)
)
.shadow(color: Color.black.opacity(0.05), radius: 10, x: 0, y: 4)
```

#### Text Styles (SwiftUI)

```swift
// Heading 1
Text("Build something")
    .font(.system(size: 48, weight: .medium))
    .foregroundColor(Color(hex: "1C1C1C"))

// Heading 3
Text("Section Title")
    .font(.system(size: 18, weight: .medium))
    .foregroundColor(Color(hex: "1C1C1C"))

// Body
Text("Description text")
    .font(.system(size: 16, weight: .regular))
    .foregroundColor(Color(hex: "1C1C1C"))

// Caption/Muted
Text("Supporting text")
    .font(.system(size: 14, weight: .regular))
    .foregroundColor(Color(hex: "888888"))
```

### Gradient Background (iOS)

```swift
// Lovable-style gradient for hero sections
LinearGradient(
    gradient: Gradient(colors: [
        Color(hex: "E8F4FC"),  // Light blue top
        Color(hex: "D4F1F4"),  // Cyan
        Color(hex: "FFE5D9"),  // Peach
        Color(hex: "FFD4B8")   // Coral bottom
    ]),
    startPoint: .top,
    endPoint: .bottom
)
```

---

## Summary: Key Design Principles

1. **Warmth through color:** Use coral/orange accents sparingly to add warmth
2. **Clean and minimal:** Generous whitespace, simple layouts
3. **Consistent rounding:** 6px for buttons/inputs, 16px for cards
4. **Subtle depth:** Light shadows, bordered cards
5. **Readable typography:** Medium weight for emphasis, regular for body
6. **Accessible contrast:** Maintain WCAG compliance in light theme

---

*Generated for iOS light theme adaptation of Lovable.dev design system*
