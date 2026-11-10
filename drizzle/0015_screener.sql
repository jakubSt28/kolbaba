CREATE TABLE "senders" (
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "senders_user_id_email_pk" PRIMARY KEY("user_id","email")
);
--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "screening" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "senders" ADD CONSTRAINT "senders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;