import { useState } from 'react';
import { BookTemplate, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Template {
  id: string;
  label: string;
  emoji: string;
  requirement: string;
}

const TEMPLATES: Template[] = [
  {
    id: 'login',
    label: 'Login / Authentication',
    emoji: '🔐',
    requirement: `As a registered user, I want to log in to the application using my email and password so that I can access my account securely.\n\nAcceptance Criteria:\n- User can enter email and password\n- System validates credentials and shows appropriate error messages\n- Successful login redirects to the dashboard\n- "Forgot password" link is available\n- Account locks after 5 failed attempts\n- Session expires after 30 minutes of inactivity`,
  },
  {
    id: 'crud',
    label: 'CRUD Operations',
    emoji: '📝',
    requirement: `As an admin user, I want to create, read, update, and delete records in the system so that I can manage data effectively.\n\nAcceptance Criteria:\n- User can create a new record with required fields (name, description, status)\n- Records are displayed in a paginated table with sorting\n- User can edit any field of an existing record\n- User can delete a record with a confirmation dialog\n- Validation errors are shown for invalid inputs\n- Changes are reflected immediately in the list`,
  },
  {
    id: 'file-upload',
    label: 'File Upload',
    emoji: '📁',
    requirement: `As a user, I want to upload files (images, documents) to the application so that I can attach them to my records.\n\nAcceptance Criteria:\n- Supports drag-and-drop and click-to-browse\n- Accepted formats: JPG, PNG, PDF, DOCX (max 10MB)\n- Shows upload progress bar\n- Displays preview for images\n- User can remove uploaded files before submitting\n- Shows clear error message for invalid file type or size`,
  },
  {
    id: 'search-filter',
    label: 'Search & Filters',
    emoji: '🔍',
    requirement: `As a user, I want to search and filter data in the application so that I can quickly find relevant records.\n\nAcceptance Criteria:\n- Real-time search with debounced input (300ms)\n- Filter by status (Active, Inactive, Pending), date range, and category\n- Multiple filters can be combined\n- "Clear all filters" button resets everything\n- Shows result count and "No results found" state\n- Filters persist across pagination`,
  },
  {
    id: 'registration',
    label: 'User Registration',
    emoji: '👤',
    requirement: `As a new user, I want to register an account so that I can start using the application.\n\nAcceptance Criteria:\n- Registration form with: full name, email, password, confirm password\n- Password must be 8+ chars with uppercase, lowercase, number, special char\n- Email must be unique and valid format\n- Sends verification email after registration\n- Shows terms & conditions checkbox (required)\n- Inline validation as user types`,
  },
  {
    id: 'checkout',
    label: 'Checkout / Payment',
    emoji: '💳',
    requirement: `As a buyer, I want to complete a purchase through a checkout flow so that I can buy products.\n\nAcceptance Criteria:\n- Cart summary with item details, quantities, and prices\n- Shipping address form with validation\n- Multiple payment methods (credit card, PayPal)\n- Order total updates with tax and shipping costs\n- Promo code input with validation\n- Order confirmation page with order number and email receipt`,
  },
];

interface TemplateLibraryProps {
  onSelect: (requirement: string) => void;
}

export function TemplateLibrary({ onSelect }: TemplateLibraryProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className="gap-2 text-xs border-border/60 hover:bg-muted/50"
      >
        <BookTemplate className="h-3.5 w-3.5" />
        Templates
        {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </Button>

      {isOpen && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 animate-fade-in">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                onSelect(t.requirement);
                setIsOpen(false);
              }}
              className={cn(
                'flex items-center gap-2 p-2.5 rounded-xl text-left text-sm',
                'bg-muted/40 hover:bg-muted/70 border border-border/40 hover:border-primary/40',
                'transition-all duration-200'
              )}
            >
              <span className="text-lg">{t.emoji}</span>
              <span className="font-medium text-foreground text-xs leading-tight">{t.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
