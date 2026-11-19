from supabase_client import supabase

tables = [
    "profiles",
    "subjects",
    "exam_plans",
    "topics",
    "study_sessions",
    "study_materials",
    "material_chunks",
    "quizzes",
    "quiz_questions",
    "quiz_attempts",
    "quiz_answers",
    "quiz_assessments",
    "question_topic_mappings",
    "review_plans",
    "flashcards",
    "flashcard_reviews",
    "study_reminders",
]

for table in tables:
    try:
        response = supabase.table(table).select("*").limit(1).execute()
        row_count = len(response.data or [])
        print(f"[OK]     {table}: truy cập được, mẫu={row_count}")
    except Exception as error:
        print(f"[ERROR]  {table}: {error}")
